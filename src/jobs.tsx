// 작업 파이프라인 - 생성 작업 관리
import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const jobs = new Hono<{ Bindings: Bindings }>()

// Gemini API로 블로그 글 생성
const generateWithGemini = async (article: any, apiKey: string): Promise<string> => {
  const prompt = `
당신은 전문 블로그 작가입니다. 다음 정보를 바탕으로 고품질 블로그 글을 작성해주세요.

**글 정보:**
- 제목: ${article.title}
- 주제: ${article.topic}  
- 키워드: ${article.keywords}
- 목표 길이: ${article.target_length}자
- 톤앤매너: ${article.tone}
- 타겟 독자: ${article.audience}

**작성 요구사항:**
1. SEO 최적화된 구조 (제목, 소제목, 키워드 적절히 배치)
2. 독자 참여를 유도하는 매력적인 내용
3. 실용적인 정보와 인사이트 제공
4. ${article.tone} 톤으로 ${article.audience}에게 적합한 문체
5. 목표 길이 ${article.target_length}자 내외로 작성

마크다운 형식으로 작성해주세요.
`

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    })
  })

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`)
  }

  const data = await response.json()
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  
  if (!content) {
    throw new Error('No content generated from Gemini API')
  }

  return content
}

// 작업 생성 (시트에서 트리거)
jobs.post('/trigger-from-sheets', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  try {
    const url = new URL(c.req.url)
    const limit = Math.min(Number(url.searchParams.get('limit') || 5), 10) // 최대 10개

    // pending 상태의 articles 조회
    const { results: articles } = await c.env.DB.prepare(`
      SELECT id, title, topic, keywords, target_length, tone, audience
      FROM articles 
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `).bind(limit).all()

    const queuedJobs = []
    
    for (const article of articles as any[]) {
      // 멱등성 키 생성
      const idempotencyKey = `article_${article.id}_${Date.now()}`
      
      // generation_jobs에 작업 생성
      const jobResult = await c.env.DB.prepare(`
        INSERT INTO generation_jobs 
        (article_id, status, idempotency_key, payload, created_at)
        VALUES (?, 'queued', ?, ?, datetime('now'))
        RETURNING id
      `).bind(
        article.id,
        idempotencyKey,
        JSON.stringify({ 
          action: 'generate_content',
          article_id: article.id,
          triggered_by: user.id 
        })
      ).first()

      // article 상태 업데이트
      await c.env.DB.prepare(`
        UPDATE articles 
        SET status = 'processing', updated_at = datetime('now')
        WHERE id = ?
      `).bind(article.id).run()

      queuedJobs.push({
        job_id: jobResult?.id,
        article_id: article.id,
        title: article.title,
        idempotency_key: idempotencyKey
      })
    }

    // 감사 로그
    await c.env.DB.prepare(`
      INSERT INTO audit_logs (user_id, action, detail)
      VALUES (?, 'JOBS_TRIGGERED', ?)
    `).bind(user.id, `Queued ${queuedJobs.length} generation jobs`).run()

    return c.json({
      success: true,
      message: `Queued ${queuedJobs.length} generation jobs`,
      jobs: queuedJobs
    })

  } catch (error: any) {
    console.error('Job trigger error:', error)
    return c.json({
      error: 'Failed to trigger jobs',
      details: error.message
    }, 500)
  }
})

// 개별 작업 실행
jobs.post('/:id/run', async (c) => {
  const user = c.get('user')
  const jobId = c.req.param('id')
  
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  try {
    // 작업 정보 조회
    const job = await c.env.DB.prepare(`
      SELECT j.id, j.article_id, j.status, j.attempt, j.payload,
             a.title, a.topic, a.keywords, a.target_length, a.tone, a.audience
      FROM generation_jobs j
      JOIN articles a ON j.article_id = a.id
      WHERE j.id = ?
    `).bind(jobId).first()

    if (!job) {
      return c.json({ error: 'Job not found' }, 404)
    }

    if (job.status === 'running') {
      return c.json({ error: 'Job is already running' }, 409)
    }

    if (job.status === 'succeeded') {
      return c.json({ error: 'Job already completed' }, 409)
    }

    // 작업 상태를 running으로 변경
    await c.env.DB.prepare(`
      UPDATE generation_jobs 
      SET status = 'running', attempt = attempt + 1, updated_at = datetime('now')
      WHERE id = ?
    `).bind(jobId).run()

    try {
      // Gemini API로 콘텐츠 생성
      const apiKey = c.env.GOOGLE_GENAI_API_KEY || c.env.GEMINI_API_KEY || ''
      if (!apiKey) {
        throw new Error('Gemini API key not configured')
      }

      const content = await generateWithGemini(job, apiKey)
      const wordCount = content.length

      // articles 업데이트
      await c.env.DB.prepare(`
        UPDATE articles 
        SET content = ?, word_count = ?, status = 'completed', 
            generated_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).bind(content, wordCount, job.article_id).run()

      // 작업 완료
      await c.env.DB.prepare(`
        UPDATE generation_jobs 
        SET status = 'succeeded', logs = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(`Content generated successfully. Word count: ${wordCount}`, jobId).run()

      // 감사 로그
      await c.env.DB.prepare(`
        INSERT INTO audit_logs (user_id, action, detail)
        VALUES (?, 'CONTENT_GENERATED', ?)
      `).bind(user.id, `Generated content for article ${job.article_id}: ${job.title}`).run()

      return c.json({
        success: true,
        message: 'Content generated successfully',
        article_id: job.article_id,
        word_count: wordCount
      })

    } catch (error: any) {
      // 작업 실패
      const errorMsg = error.message || 'Unknown error'
      
      await c.env.DB.prepare(`
        UPDATE generation_jobs 
        SET status = 'failed', logs = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(`Generation failed: ${errorMsg}`, jobId).run()

      await c.env.DB.prepare(`
        UPDATE articles 
        SET status = 'error', updated_at = datetime('now')
        WHERE id = ?
      `).bind(job.article_id).run()

      return c.json({
        error: 'Content generation failed',
        details: errorMsg
      }, 500)
    }

  } catch (error: any) {
    console.error('Job execution error:', error)
    return c.json({
      error: 'Failed to execute job',
      details: error.message
    }, 500)
  }
})

// 작업 목록 조회
jobs.get('/', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  try {
    const url = new URL(c.req.url)
    const limit = Math.min(Number(url.searchParams.get('limit') || 20), 100)
    const status = url.searchParams.get('status')

    let query = `
      SELECT j.id, j.status, j.attempt, j.created_at, j.updated_at,
             a.id as article_id, a.title, a.topic, a.status as article_status
      FROM generation_jobs j
      JOIN articles a ON j.article_id = a.id
    `
    
    const params: any[] = []
    
    if (status) {
      query += ' WHERE j.status = ?'
      params.push(status)
    }
    
    query += ' ORDER BY j.created_at DESC LIMIT ?'
    params.push(limit)

    const { results: jobs } = await c.env.DB.prepare(query).bind(...params).all()

    return c.json({
      success: true,
      jobs: jobs || []
    })

  } catch (error: any) {
    console.error('Jobs list error:', error)
    return c.json({
      error: 'Failed to fetch jobs',
      details: error.message
    }, 500)
  }
})

// 개별 작업 상세 조회
jobs.get('/:id', async (c) => {
  const user = c.get('user')
  const jobId = c.req.param('id')
  
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  try {
    const job = await c.env.DB.prepare(`
      SELECT j.*, a.title, a.content, a.word_count
      FROM generation_jobs j
      JOIN articles a ON j.article_id = a.id
      WHERE j.id = ?
    `).bind(jobId).first()

    if (!job) {
      return c.json({ error: 'Job not found' }, 404)
    }

    return c.json({
      success: true,
      job
    })

  } catch (error: any) {
    return c.json({
      error: 'Failed to fetch job details',
      details: error.message
    }, 500)
  }
})

export default jobs
// Google Sheets API 연동
import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const sheets = new Hono<{ Bindings: Bindings }>()

// Google Sheets API 헬퍼 함수
const getGoogleToken = async (db: D1Database, userId: number): Promise<string | null> => {
  const tokenRow = await db.prepare(`
    SELECT access_token_enc, refresh_token_enc, expires_at
    FROM api_tokens 
    WHERE user_id = ? AND provider = 'google'
    ORDER BY updated_at DESC
    LIMIT 1
  `).bind(userId).first()

  if (!tokenRow) return null

  try {
    // 실제 프로덕션에서는 ENCRYPTION_KEY로 복호화 필요
    const tokenData = JSON.parse(atob(tokenRow.access_token_enc as string))
    
    // 토큰 만료 확인 및 리프레시 로직 (향후 구현)
    return tokenData.access_token
  } catch {
    return null
  }
}

// Sheets 데이터 읽기 (실제 Google Sheets API 호출)
const fetchSheetsData = async (spreadsheetId: string, range: string, accessToken: string) => {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`Sheets API error: ${response.status}`)
  }

  return await response.json()
}

// 시트 데이터를 articles 테이블 형식으로 변환
const parseSheetRows = (rows: string[][]): any[] => {
  if (!rows || rows.length < 2) return []

  const articles = []
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row[0] || !row[1]) continue // 웹툰명과 프롬프트 내용이 있는 행만

    const title = row[0] // 웹툰명
    const prompt = row[1] // 프롬프트 내용
    
    // 프롬프트에서 키워드 추출 (간단한 파싱)
    const keywords = extractKeywords(prompt)
    const targetLength = extractTargetLength(prompt)
    const tone = extractTone(prompt)
    const audience = extractAudience(prompt)

    articles.push({
      ext_id: `sheet_row_${i}`,
      title,
      topic: title, // 웹툰명을 주제로 사용
      keywords: keywords.join(','),
      target_length: targetLength,
      tone,
      audience,
      content: '', // 생성 전이므로 빈 값
      status: 'pending'
    })
  }

  return articles
}

// 프롬프트에서 정보 추출하는 헬퍼 함수들
const extractKeywords = (prompt: string): string[] => {
  // 키워드 추출 로직 (예: "타겟 키워드", "핵심 키워드" 등에서 추출)
  const keywordMatch = prompt.match(/(?:키워드|keyword)[:\s]*([^\n\r]+)/i)
  if (keywordMatch) {
    return keywordMatch[1].split(/[,\s]+/).filter(k => k.length > 0).slice(0, 4)
  }
  return ['웹툰', '스토리', '캐릭터']
}

const extractTargetLength = (prompt: string): number => {
  // 길이 정보 추출
  const lengthMatch = prompt.match(/(\d+)자/g)
  if (lengthMatch) {
    const numbers = lengthMatch.map(m => parseInt(m.replace('자', '')))
    return Math.max(...numbers)
  }
  return 1500 // 기본값
}

const extractTone = (prompt: string): string => {
  // 톤앤매너 추출
  if (prompt.includes('전문적')) return '전문적이면서 접근하기 쉬운'
  if (prompt.includes('친근')) return '친근하고 재미있는'
  if (prompt.includes('분석적')) return '분석적이고 객관적인'
  return '매력적이고 흥미로운'
}

const extractAudience = (prompt: string): string => {
  // 타겟 독자 추출
  if (prompt.includes('청소년')) return '청소년 및 젊은 성인'
  if (prompt.includes('성인')) return '성인 독자'
  if (prompt.includes('전문가')) return '웹툰 전문가 및 크리에이터'
  return '웹툰 독자 및 팬'
}

// 시트에서 데이터 가져와서 articles 테이블에 동기화
sheets.post('/sync', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  try {
    const sheetsId = c.env.GOOGLE_SHEETS_ID || ''
    const range = 'Sheet1!A:B' // A열: 웹툰명, B열: 프롬프트 내용
    
    if (!sheetsId) {
      return c.json({ error: 'Google Sheets ID not configured' }, 400)
    }

    // Google API 토큰 가져오기
    const accessToken = await getGoogleToken(c.env.DB, user.id)
    if (!accessToken) {
      return c.json({ error: 'Google API token not found. Please re-authenticate.' }, 401)
    }

    // Sheets 데이터 가져오기
    const sheetsData = await fetchSheetsData(sheetsId, range, accessToken)
    const articles = parseSheetRows(sheetsData.values || [])

    // articles 테이블에 동기화
    let syncedCount = 0
    for (const article of articles) {
      // 기존 항목 확인
      const existing = await c.env.DB.prepare(`
        SELECT id FROM articles WHERE ext_id = ?
      `).bind(article.ext_id).first()

      if (!existing) {
        // 새 항목 삽입
        await c.env.DB.prepare(`
          INSERT INTO articles 
          (ext_id, title, topic, keywords, target_length, tone, audience, content, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          article.ext_id,
          article.title,
          article.topic,
          article.keywords,
          article.target_length,
          article.tone,
          article.audience,
          article.content,
          article.status
        ).run()
        
        syncedCount++
      }
    }

    // 감사 로그
    await c.env.DB.prepare(`
      INSERT INTO audit_logs (user_id, action, detail)
      VALUES (?, 'SHEETS_SYNC', ?)
    `).bind(user.id, `Synced ${syncedCount} new articles from Google Sheets`).run()

    return c.json({
      success: true,
      message: `Successfully synced ${syncedCount} new articles`,
      totalFound: articles.length,
      newSynced: syncedCount
    })

  } catch (error: any) {
    console.error('Sheets sync error:', error)
    return c.json({ 
      error: 'Failed to sync with Google Sheets',
      details: error.message 
    }, 500)
  }
})

// 시트 연결 테스트
sheets.get('/test', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  try {
    const sheetsId = c.env.GOOGLE_SHEETS_ID || ''
    if (!sheetsId) {
      return c.json({ error: 'Google Sheets ID not configured' }, 400)
    }

    const accessToken = await getGoogleToken(c.env.DB, user.id)
    if (!accessToken) {
      return c.json({ error: 'Google API token not found' }, 401)
    }

    // 간단한 메타데이터 조회
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetsId}?fields=properties.title,sheets.properties.title`
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const data = await response.json()
    return c.json({
      success: true,
      spreadsheet: {
        title: data.properties?.title,
        sheets: data.sheets?.map((s: any) => s.properties?.title) || []
      }
    })

  } catch (error: any) {
    return c.json({
      success: false,
      error: error.message
    }, 500)
  }
})

export default sheets
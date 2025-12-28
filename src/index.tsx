import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import auth, { requireAuth, requireRole } from './auth'
import sheets from './sheets'
import jobs from './jobs'

// 블로그 자동화 시스템 타입 정의
interface BlogPost {
  id: string
  title: string
  topic: string
  keywords: string[]
  targetLength: number
  tone: string
  audience: string
  content: string
  status: 'pending' | 'processing' | 'completed' | 'error'
  createdAt: string
  updatedAt?: string
  driveFileId?: string
  wordCount?: number
  generatedAt?: string
}

interface ProcessingStats {
  total: number
  completed: number
  pending: number
  errors: number
}

type Bindings = {
  DB: D1Database
  KV: KVNamespace
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS 설정
app.use('/api/*', cors())

// 정적 파일 서빙
app.use('/static/*', serveStatic({ root: './public' }))

// 메모리 저장소 (데모용) - 프로덕션에서는 D1 사용
let blogPosts: BlogPost[] = []
let processingQueue: string[] = []

// 메인 대시보드
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>XIΛIX Blog Series Step_07 - 블로그 자동 대량 생산 시스템</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <link href="/static/typography.css" rel="stylesheet">
        <link href="/static/security.css" rel="stylesheet">
        <style>
          .processing { animation: pulse 2s infinite; }
          .status-pending { @apply bg-yellow-100 text-yellow-800; }
          .status-processing { @apply bg-blue-100 text-blue-800; }
          .status-completed { @apply bg-green-100 text-green-800; }
          .status-error { @apply bg-red-100 text-red-800; }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
          }
        </style>
    </head>
    <body class="bg-gray-50 min-h-screen">
        <!-- 메시지 컨테이너 -->
        <div id="message-container" class="fixed top-4 right-4 z-50 space-y-2"></div>
        
        <div class="w-full px-4 py-6 md:py-8">
            <!-- 헤더 -->
            <div class="bg-white rounded-lg shadow-sm p-4 md:p-6 mb-6 md:mb-8 mobile-optimized card">
                <div class="text-center mb-4">
                    <h1 class="text-2xl md:text-4xl font-bold text-gray-800 mb-2">
                        <span class="xivix-brand">XIΛIX</span>
                        <i class="fas fa-robot text-blue-500 mx-2"></i>
                        Blog Series Step_07
                    </h1>
                    <h2 class="text-lg md:text-2xl font-semibold text-gray-700 mb-2">
                        블로그 자동 대량 생산 시스템
                    </h2>
                    <p class="text-gray-600 text-sm md:text-lg">Google Sheets → Gemini AI → Google Drive 자동화 워크플로우</p>
                </div>
                
                <!-- 사용량 표시 -->
                <div id="usage-display" class="mt-4"></div>
                
                <div class="mt-4 text-sm" id="auth-status">
                    <i class="fas fa-spinner fa-spin mr-1"></i>
                    인증 상태 확인 중...
                </div>
            </div>

            <!-- 통계 카드 -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6 mb-6 md:mb-8">
                <div class="bg-white rounded-lg shadow-sm p-4 md:p-8 mobile-optimized card hover:shadow-lg transition-shadow">
                    <div class="flex items-center">
                        <div class="p-3 md:p-4 bg-blue-100 rounded-lg mr-3 md:mr-4">
                            <i class="fas fa-list text-blue-600 text-lg md:text-2xl"></i>
                        </div>
                        <div>
                            <h3 class="text-xs md:text-sm font-medium text-gray-500 uppercase">전체 글</h3>
                            <p class="text-xl md:text-3xl font-bold text-gray-900" id="total-posts">0</p>
                        </div>
                    </div>
                </div>

                <div class="bg-white rounded-lg shadow-sm p-4 md:p-8 mobile-optimized card hover:shadow-lg transition-shadow">
                    <div class="flex items-center">
                        <div class="p-3 md:p-4 bg-yellow-100 rounded-lg mr-3 md:mr-4">
                            <i class="fas fa-clock text-yellow-600 text-lg md:text-2xl"></i>
                        </div>
                        <div>
                            <h3 class="text-xs md:text-sm font-medium text-gray-500 uppercase">대기중</h3>
                            <p class="text-xl md:text-3xl font-bold text-gray-900" id="pending-posts">0</p>
                        </div>
                    </div>
                </div>

                <div class="bg-white rounded-lg shadow-sm p-4 md:p-8 mobile-optimized card hover:shadow-lg transition-shadow">
                    <div class="flex items-center">
                        <div class="p-3 md:p-4 bg-green-100 rounded-lg mr-3 md:mr-4">
                            <i class="fas fa-check text-green-600 text-lg md:text-2xl"></i>
                        </div>
                        <div>
                            <h3 class="text-xs md:text-sm font-medium text-gray-500 uppercase">완료</h3>
                            <p class="text-xl md:text-3xl font-bold text-gray-900" id="completed-posts">0</p>
                        </div>
                    </div>
                </div>

                <div class="bg-white rounded-lg shadow-sm p-4 md:p-8 mobile-optimized card hover:shadow-lg transition-shadow">
                    <div class="flex items-center">
                        <div class="p-3 md:p-4 bg-red-100 rounded-lg mr-3 md:mr-4">
                            <i class="fas fa-exclamation-triangle text-red-600 text-lg md:text-2xl"></i>
                        </div>
                        <div>
                            <h3 class="text-xs md:text-sm font-medium text-gray-500 uppercase">오류</h3>
                            <p class="text-xl md:text-3xl font-bold text-gray-900" id="error-posts">0</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 인증 및 시작 섹션 -->
            <div id="auth-section" class="bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg shadow-sm p-4 md:p-6 mb-6 md:mb-8 text-white mobile-optimized card">
                <h2 class="text-lg md:text-xl font-semibold mb-2">
                    <i class="fas fa-sign-in-alt mr-2"></i>
                    Google 로그인 필요
                </h2>
                <p class="mb-4 text-blue-100 text-sm md:text-base">Google 계정으로 로그인하여 Sheets/Drive API를 사용하세요.</p>
                <a href="/auth/google" 
                   class="bg-white text-blue-600 px-4 md:px-6 py-2 md:py-3 rounded-lg hover:bg-blue-50 font-semibold inline-block mobile-btn text-sm md:text-base">
                    <i class="fab fa-google mr-2"></i>
                    Google로 로그인
                </a>
            </div>

            <!-- 로그인 후 컨트롤 패널 -->
            <div id="control-section" class="bg-gradient-to-r from-green-500 to-blue-600 rounded-lg shadow-sm p-4 md:p-6 mb-6 md:mb-8 text-white mobile-optimized card" style="display: none;">
                <h2 class="text-lg md:text-xl font-semibold mb-2">
                    <i class="fas fa-cogs mr-2"></i>
                    시스템 컨트롤
                </h2>
                <p class="mb-4 text-green-100 text-sm md:text-base">Google Sheets에서 데이터를 가져와 자동 생성을 시작하세요.</p>
                
                <!-- 시각적 계층 구조 적용 -->
                <div class="mb-4">
                    <h3 class="text-sm font-semibold mb-2 text-green-100">실행 단계:</h3>
                    <ul class="ordered-list text-sm space-y-1">
                        <li>시트에서 데이터 동기화</li>
                        <li>AI 콘텐츠 생성 작업 시작</li>
                        <li>생성 완료된 글 현황 확인</li>
                    </ul>
                </div>
                
                <div class="flex flex-col sm:flex-row gap-2 md:gap-3">
                    <button onclick="syncFromSheets()" 
                            class="bg-white text-green-600 px-4 py-2 md:py-3 rounded-lg hover:bg-green-50 font-semibold mobile-btn text-sm md:text-base">
                        <i class="fas fa-sync mr-2"></i>
                        시트 동기화
                    </button>
                    <button onclick="triggerJobs()" 
                            class="bg-white text-blue-600 px-4 py-2 md:py-3 rounded-lg hover:bg-blue-50 font-semibold mobile-btn text-sm md:text-base">
                        <i class="fas fa-play mr-2"></i>
                        작업 시작
                    </button>
                    <button onclick="showJobs()" 
                            class="bg-white text-purple-600 px-4 py-2 md:py-3 rounded-lg hover:bg-purple-50 font-semibold mobile-btn text-sm md:text-base">
                        <i class="fas fa-list mr-2"></i>
                        작업 현황
                    </button>
                </div>
            </div>

            <!-- 데모 모드 (로그인 전용) -->
            <div id="demo-section" class="bg-gradient-to-r from-gray-500 to-gray-600 rounded-lg shadow-sm p-4 md:p-6 mb-6 md:mb-8 text-white mobile-optimized card" style="display: none;">
                <h2 class="text-lg md:text-xl font-semibold mb-2">
                    <i class="fas fa-play-circle mr-2"></i>
                    데모 모드
                </h2>
                <p class="mb-4 text-gray-200 text-sm md:text-base">로그인 없이 기본 기능을 체험해보세요.</p>
                
                <!-- 데모 기능 설명 -->
                <div class="mb-4">
                    <h3 class="text-sm font-semibold mb-2 text-gray-200">데모에서 체험 가능:</h3>
                    <ul class="check-list text-sm space-y-1">
                        <li>샘플 블로그 글 데이터 로드</li>
                        <li>AI 프롬프트 기반 고품질 콘텐츠 생성</li>
                        <li>실시간 작업 진행 상태 모니터링</li>
                    </ul>
                </div>
                
                <button onclick="quickStart()" 
                        class="bg-white text-gray-600 px-4 md:px-6 py-2 md:py-3 rounded-lg hover:bg-gray-50 font-semibold mobile-btn text-sm md:text-base">
                    <i class="fas fa-rocket mr-2"></i>
                    데모 시작하기
                </button>
            </div>

            <!-- 컨트롤 패널 -->
            <div class="bg-white rounded-lg shadow-sm p-4 md:p-6 mb-6 md:mb-8 mobile-optimized card">
                <h2 class="text-lg md:text-2xl font-semibold text-gray-800 mb-4">
                    <i class="fas fa-cogs text-gray-600 mr-2"></i>
                    Gemini AI 설정
                </h2>
                
                <!-- Gemini API 키 입력 섹션 -->
                <div class="mb-6 p-4 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg">
                    <h3 class="text-md font-semibold mb-3 text-purple-800">
                        <i class="fas fa-brain text-purple-600 mr-2"></i>
                        Gemini AI API 키 설정
                    </h3>
                    <div class="mb-3">
                        <input type="password" 
                               id="gemini-api-key" 
                               placeholder="Gemini API 키를 입력하세요 (예: AIzaSy...)" 
                               class="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm mobile-btn api-key-input focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                        <p class="text-xs text-gray-500 mt-2">
                            <i class="fas fa-shield-alt mr-1"></i>
                            API 키는 브라우저에 암호화되어 저장되며, 서버로 전송되지 않습니다.
                        </p>
                    </div>
                    <div id="api-key-status" class="mb-3"></div>
                </div>

                <!-- API 설정 필요 사항 안내 -->
                <div class="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <h3 class="text-sm font-semibold mb-2 text-blue-800">추가 API 설정 (선택사항):</h3>
                    <ul class="emphasis-list text-sm space-y-1 text-blue-700">
                        <li>Google Sheets API - 스프레드시트 데이터 읽기</li>
                        <li>Google Drive API - 생성된 글 자동 저장</li>
                    </ul>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <!-- Google Sheets 연동 -->
                    <div class="border rounded-lg p-4 bg-gray-50">
                        <h3 class="font-medium text-gray-600 mb-2">
                            <i class="fas fa-table text-green-600 mr-2"></i>
                            Google Sheets (선택)
                        </h3>
                        <div class="mb-2">
                            <input type="text" id="sheets-url" placeholder="Google Sheets URL" 
                                   class="w-full px-3 py-2 border rounded-md text-sm mb-2 mobile-btn" disabled>
                            <input type="password" id="sheets-api-key" placeholder="Google API Key" 
                                   class="w-full px-3 py-2 border rounded-md text-sm mobile-btn" disabled>
                        </div>
                        <button onclick="showComingSoon('Google Sheets 연동')" 
                                class="w-full bg-gray-400 text-white px-4 py-2 rounded-md text-sm mobile-btn cursor-not-allowed">
                            준비 중...
                        </button>
                    </div>

                    <!-- Google Drive 설정 -->
                    <div class="border rounded-lg p-4 bg-gray-50">
                        <h3 class="font-medium text-gray-600 mb-2">
                            <i class="fas fa-cloud text-blue-600 mr-2"></i>
                            Google Drive (선택)
                        </h3>
                        <div class="mb-2">
                            <input type="text" id="drive-folder" placeholder="폴더 ID" 
                                   class="w-full px-3 py-2 border rounded-md text-sm mb-2 mobile-btn" disabled>
                            <input type="password" id="drive-token" placeholder="Access Token" 
                                   class="w-full px-3 py-2 border rounded-md text-sm mobile-btn" disabled>
                        </div>
                        <button onclick="showComingSoon('Google Drive 연동')" 
                                class="w-full bg-gray-400 text-white px-4 py-2 rounded-md text-sm mobile-btn cursor-not-allowed">
                            준비 중...
                        </button>
                    </div>
                </div>
            </div>

            <!-- 글 목록 -->
            <div class="bg-white rounded-lg shadow-sm p-4 md:p-6 mobile-optimized card">
                <h2 class="text-lg md:text-2xl font-semibold text-gray-800 mb-4">
                    <i class="fas fa-file-alt text-gray-600 mr-2"></i>
                    블로그 글 목록
                </h2>
                
                <div class="overflow-x-auto">
                    <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-3 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">제목</th>
                                <th class="px-3 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase desktop-only">주제</th>
                                <th class="px-3 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">상태</th>
                                <th class="px-3 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">액션</th>
                            </tr>
                        </thead>
                        <tbody id="posts-table" class="bg-white divide-y divide-gray-200">
                            <tr>
                                <td colspan="4" class="px-3 md:px-6 py-8 text-center text-gray-500">
                                    <i class="fas fa-inbox text-2xl md:text-4xl mb-4 block text-gray-300"></i>
                                    <p class="text-sm md:text-lg font-medium text-gray-600 mb-2">아직 글이 없습니다.</p>
                                    <p class="text-xs md:text-base text-gray-500">"데모 시작하기"를 클릭해보세요!</p>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                
                <!-- 결과물 표시 영역 -->
                <div id="generated-content" style="display: none;" class="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <div class="flex justify-between items-center mb-3">
                        <h3 class="text-lg font-semibold text-gray-800">
                            <i class="fas fa-magic mr-2 text-purple-600"></i>
                            생성된 블로그 글
                        </h3>
                        <button id="copy-content-btn" 
                                onclick="copyGeneratedContent()" 
                                class="copy-btn bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                            <i class="fas fa-copy mr-1"></i>
                            복사하기
                        </button>
                    </div>
                    <div id="content-display" class="result-copyable bg-white p-4 border border-gray-300 rounded-lg min-h-40 max-h-96 overflow-y-auto"
                         style="font-family: 'Noto Sans KR', sans-serif; line-height: 1.6; white-space: pre-wrap;">
                        <!-- 생성된 콘텐츠가 여기에 표시됩니다 -->
                    </div>
                </div>
            </div>
        </div>

        <!-- XIΛIX 푸터 -->
        <div class="xivix-footer">
            <div class="container mx-auto px-4 py-6">
                <div class="text-center">
                    <h3 class="text-lg font-bold mb-2 xivix-brand">XIΛIX Blog Series Step_07</h3>
                    <p class="text-sm mb-4">고품질 블로그 자동화 솔루션 - AI 기반 대량 생산 시스템</p>
                    <div class="border-t border-white/20 pt-4">
                        <a href="https://xivix.kr/" target="_blank" class="hover:underline font-semibold">
                            클릭하면 링크로 접속되게 https://xivix.kr/  |@**XIΛIX**ㅣ© 2025. ALL RIGHTS RESERVED.
                        </a>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/security.js"></script>
        <script src="/static/app.js"></script>
        <script>
        // 보안 강화 및 새로운 기능들
        
        // 생성된 콘텐츠 복사 기능
        function copyGeneratedContent() {
            const contentDiv = document.getElementById('content-display');
            const copyBtn = document.getElementById('copy-content-btn');
            
            if (contentDiv && contentDiv.textContent.trim()) {
                copyToClipboard(contentDiv.textContent, copyBtn);
            } else {
                showErrorMessage('복사할 콘텐츠가 없습니다.');
            }
        }
        
        // Coming Soon 알림
        function showComingSoon(feature) {
            showErrorMessage(feature + ' 기능은 곧 출시될 예정입니다.');
        }
        
        // 개선된 데모 시작 기능
        async function quickStart() {
            if (!usageLimiter.canUse()) {
                showErrorMessage('일일 사용 한도(' + usageLimiter.maxDaily + '회)에 도달했습니다. 내일 다시 시도해주세요.');
                return;
            }
            
            if (!apiKeyManager.hasValidKey()) {
                showErrorMessage('먼저 Gemini API 키를 입력해주세요.');
                document.getElementById('gemini-api-key').focus();
                return;
            }
            
            try {
                showLoadingOverlay('데모 데이터 초기화 중...');
                
                // 데모 데이터 초기화
                const initResponse = await axios.post('/api/demo/init');
                if (initResponse.data.success) {
                    await updateStats();
                    await updatePostsTable();
                    
                    hideLoadingOverlay();
                    showSuccessMessage('데모 데이터가 성공적으로 로드되었습니다!');
                    
                    // 첫 번째 글 자동 생성
                    setTimeout(() => generateFirstDemo(), 1000);
                } else {
                    throw new Error(initResponse.data.message || '데모 초기화 실패');
                }
            } catch (error) {
                hideLoadingOverlay();
                showErrorMessage('데모 시작 실패: ' + error.message);
            }
        }
        
        // 첫 번째 데모 글 생성
        async function generateFirstDemo() {
            const apiKey = apiKeyManager.getApiKey();
            if (!apiKey) {
                showErrorMessage('Gemini API 키를 먼저 입력해주세요.');
                return;
            }
            
            try {
                showLoadingOverlay('AI가 블로그 글을 생성하고 있습니다...<br><small>이 과정은 약 10-15초 소요됩니다</small>');
                
                const response = await axios.post('/api/demo/generate/demo_1', {
                    apiKey: apiKey
                });
                
                if (response.data.success) {
                    usageLimiter.incrementUsage();
                    
                    hideLoadingOverlay();
                    showSuccessMessage('고품질 블로그 글이 성공적으로 생성되었습니다!');
                    
                    // 결과 표시
                    displayGeneratedContent(response.data.post);
                    await updateStats();
                    await updatePostsTable();
                } else {
                    throw new Error(response.data.message || '글 생성 실패');
                }
            } catch (error) {
                hideLoadingOverlay();
                if (error.response?.data?.error === 'GEMINI_API_ERROR') {
                    showErrorMessage('Gemini API 오류: API 키를 확인해주세요. ' + error.response.data.message);
                } else {
                    showErrorMessage('글 생성 실패: ' + error.message);
                }
            }
        }
        
        // 생성된 콘텐츠 표시
        function displayGeneratedContent(post) {
            const contentContainer = document.getElementById('generated-content');
            const contentDisplay = document.getElementById('content-display');
            
            if (contentContainer && contentDisplay && post.content) {
                contentDisplay.textContent = post.content;
                contentContainer.style.display = 'block';
                
                // 스크롤해서 결과 보이기
                contentContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
        
        // 개선된 통계 업데이트
        async function updateStats() {
            try {
                const response = await axios.get('/api/stats');
                const stats = response.data;
                
                document.getElementById('total-posts').textContent = stats.total;
                document.getElementById('pending-posts').textContent = stats.pending;
                document.getElementById('completed-posts').textContent = stats.completed;
                document.getElementById('error-posts').textContent = stats.errors;
                
                // 애니메이션 효과 추가
                ['total-posts', 'pending-posts', 'completed-posts', 'error-posts'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.style.transform = 'scale(1.1)';
                        setTimeout(() => {
                            el.style.transform = 'scale(1)';
                        }, 200);
                    }
                });
                
            } catch (error) {
                console.error('Stats update failed:', error);
            }
        }
        
        // 개선된 포스트 테이블 업데이트
        async function updatePostsTable() {
            try {
                const response = await axios.get('/api/posts');
                const posts = response.data;
                const tableBody = document.getElementById('posts-table');
                
                if (!tableBody) return;
                
                if (posts.length === 0) {
                    tableBody.innerHTML = 
                        '<tr>' +
                            '<td colspan="4" class="px-3 md:px-6 py-8 text-center text-gray-500">' +
                                '<i class="fas fa-inbox text-2xl md:text-4xl mb-4 block text-gray-300"></i>' +
                                '<p class="text-sm md:text-lg font-medium text-gray-600 mb-2">아직 글이 없습니다.</p>' +
                                '<p class="text-xs md:text-base text-gray-500">"데모 시작하기"를 클릭해보세요!</p>' +
                            '</td>' +
                        '</tr>';
                } else {
                    let html = '';
                    posts.forEach(function(post) {
                        html += '<tr class="hover:bg-gray-50 transition-colors">' +
                            '<td class="px-3 md:px-6 py-4 text-sm font-medium text-gray-900">' +
                                post.title +
                                '<div class="text-xs text-gray-500 mt-1">' + (post.wordCount ? post.wordCount + '자' : '') + '</div>' +
                            '</td>' +
                            '<td class="px-3 md:px-6 py-4 text-sm text-gray-500 desktop-only">' + post.topic + '</td>' +
                            '<td class="px-3 md:px-6 py-4">' +
                                '<span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full status-' + post.status + '">' +
                                    getStatusText(post.status) +
                                '</span>' +
                            '</td>' +
                            '<td class="px-3 md:px-6 py-4 text-sm">' +
                                getActionButtons(post) +
                            '</td>' +
                        '</tr>';
                    });
                    tableBody.innerHTML = html;
                }
            } catch (error) {
                console.error('Posts table update failed:', error);
            }
        }
        
        // 상태 텍스트 변환
        function getStatusText(status) {
            const statusMap = {
                'pending': '대기중',
                'processing': '생성중',
                'completed': '완료',
                'error': '오류'
            };
            return statusMap[status] || status;
        }
        
        // 액션 버튼 생성
        function getActionButtons(post) {
            if (post.status === 'completed' && post.content) {
                return '<button onclick="showPostContent(\'' + post.id + '\')" ' +
                       'class="text-blue-600 hover:text-blue-800 font-medium text-xs md:text-sm">' +
                       '<i class="fas fa-eye mr-1"></i>보기' +
                       '</button>';
            } else if (post.status === 'pending') {
                return '<button onclick="generatePost(\'' + post.id + '\')" ' +
                       'class="text-green-600 hover:text-green-800 font-medium text-xs md:text-sm">' +
                       '<i class="fas fa-play mr-1"></i>생성' +
                       '</button>';
            }
            return '<span class="text-gray-400 text-xs">-</span>';
        }
        
        // 개별 포스트 생성
        async function generatePost(postId) {
            if (!usageLimiter.canUse()) {
                showErrorMessage('일일 사용 한도(' + usageLimiter.maxDaily + '회)에 도달했습니다.');
                return;
            }
            
            const apiKey = apiKeyManager.getApiKey();
            if (!apiKey) {
                showErrorMessage('Gemini API 키를 먼저 입력해주세요.');
                return;
            }
            
            try {
                showLoadingOverlay('AI가 블로그 글을 생성하고 있습니다...');
                
                const response = await axios.post('/api/demo/generate/' + postId, {
                    apiKey: apiKey
                });
                
                if (response.data.success) {
                    usageLimiter.incrementUsage();
                    
                    hideLoadingOverlay();
                    showSuccessMessage('블로그 글이 성공적으로 생성되었습니다!');
                    
                    displayGeneratedContent(response.data.post);
                    await updateStats();
                    await updatePostsTable();
                } else {
                    throw new Error(response.data.message || '글 생성 실패');
                }
            } catch (error) {
                hideLoadingOverlay();
                if (error.response?.data?.error === 'GEMINI_API_ERROR') {
                    showErrorMessage('Gemini API 오류: ' + error.response.data.message);
                } else {
                    showErrorMessage('글 생성 실패: ' + error.message);
                }
            }
        }
        
        // 포스트 내용 보기
        async function showPostContent(postId) {
            try {
                const response = await axios.get('/api/posts');
                const posts = response.data;
                const post = posts.find(p => p.id === postId);
                
                if (post && post.content) {
                    displayGeneratedContent(post);
                } else {
                    showErrorMessage('해당 글의 내용을 찾을 수 없습니다.');
                }
            } catch (error) {
                showErrorMessage('글 내용 로드 실패: ' + error.message);
            }
        }
        
        // 초기 인증 상태 확인
        window.addEventListener('load', () => {
            checkAuthStatus();
            // 사용량 및 API 키 상태 초기화는 security.js에서 처리됨
        });
        </script>
    </body>
    </html>
  `)
})

// API 엔드포인트들

// 헬스체크
app.get('/api/health', (c) => c.json({ ok: true }))

// 인증 라우트 마운트
app.route('/auth', auth)

// 보호된 API 라우트들
app.use('/api/sheets/*', requireAuth)
app.use('/api/jobs/*', requireAuth)  
app.route('/api/sheets', sheets)
app.route('/api/jobs', jobs)

// 인증 미들웨어(스텁): Authorization: Bearer <token>
app.use('/api/*', async (c, next) => {
  // 데모 모드: 토큰 없으면 통과. 실제 프로덕션은 JWT 검증 필수
  const auth = c.req.header('authorization')
  if (!auth) return next()
  try {
    const token = auth.replace(/^Bearer\s+/i, '')
    const secret = (c.env as any).AUTH_SECRET || 'dev-secret'
    const payload = JSON.parse(atob(token.split('.')[1] || 'e30='))
    c.set('user', payload)
  } catch (e) {
    // ignore
  }
  await next()
})

// D1 예제: 통계 계산을 DB에서 가져오는 스텁 라우트
app.get('/api/db/ping', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT datetime() as now').all()
    return c.json({ ok: true, now: results?.[0]?.now })
  } catch (e: any) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

// 통계 조회 (향후 D1 집계로 교체)
app.get('/api/stats', (c) => {
  const stats: ProcessingStats = {
    total: blogPosts.length,
    completed: blogPosts.filter(p => p.status === 'completed').length,
    pending: blogPosts.filter(p => p.status === 'pending').length,
    errors: blogPosts.filter(p => p.status === 'error').length
  }
  return c.json(stats)
})

// 글 목록 조회
app.get('/api/posts', (c) => {
  return c.json(blogPosts)
})

// 데모 데이터 생성
app.post('/api/demo/init', (c) => {
  const demoData: BlogPost[] = [
    {
      id: 'demo_1',
      title: 'AI 기반 마케팅 자동화의 혁신',
      topic: '마케팅 기술',
      keywords: ['AI 마케팅', '자동화', '개인화', 'MarTech'],
      targetLength: 1500,
      tone: '전문적이면서 접근하기 쉬운',
      audience: '마케팅 담당자 및 경영진',
      content: '',
      status: 'pending',
      createdAt: new Date().toISOString()
    },
    {
      id: 'demo_2',
      title: '블록체인이 바꿀 공급망 관리의 미래',
      topic: '블록체인 응용',
      keywords: ['블록체인', '공급망', '투명성', '추적성'],
      targetLength: 2000,
      tone: '분석적이고 객관적인',
      audience: '물류 및 공급망 전문가',
      content: '',
      status: 'pending',
      createdAt: new Date().toISOString()
    },
    {
      id: 'demo_3',
      title: '원격 근무 시대의 효과적 팀 협업 전략',
      topic: '업무 효율성',
      keywords: ['원격 근무', '팀 협업', '디지털 도구', '생산성'],
      targetLength: 1200,
      tone: '실용적이고 친근한',
      audience: '팀 리더 및 HR 담당자',
      content: '',
      status: 'pending',
      createdAt: new Date().toISOString()
    }
  ]
  
  blogPosts.length = 0
  blogPosts.push(...demoData)
  
  return c.json({ 
    success: true, 
    message: '데모 데이터 로드 완료!',
    posts: demoData 
  })
})

// 글 생성 (데모) - 클라이언트 API 키 사용
app.post('/api/demo/generate/:postId', async (c) => {
  const postId = c.req.param('postId')
  const post = blogPosts.find(p => p.id === postId)
  
  if (!post) {
    return c.json({ success: false, message: '글을 찾을 수 없습니다.' }, 404)
  }
  
  try {
    // 클라이언트에서 전송된 API 키 확인
    const body = await c.req.json().catch(() => ({}))
    const apiKey = body.apiKey || c.req.header('x-gemini-api-key')
    
    if (!apiKey) {
      return c.json({ 
        success: false, 
        message: 'Gemini API 키가 필요합니다. 페이지에서 API 키를 먼저 설정해주세요.' 
      }, 400)
    }
    
    post.status = 'processing'
    post.updatedAt = new Date().toISOString()
    
    // API 키 검증
    if (!apiKey.startsWith('AIza') || apiKey.length < 35) {
      post.status = 'error'
      return c.json({ 
        success: false, 
        message: '유효하지 않은 Gemini API 키 형식입니다.' 
      }, 400)
    }
    
    try {
      // Gemini API로 실제 콘텐츠 생성
      const geminiPrompt = `
당신은 전문 블로그 작가입니다. 다음 정보를 바탕으로 고품질 한국어 블로그 글을 작성해주세요.

**글 정보:**
- 제목: ${post.title}
- 주제: ${post.topic}
- 키워드: ${post.keywords?.join(', ') || ''}
- 목표 길이: ${post.targetLength || 1500}자
- 톤앤매너: ${post.tone || '전문적이면서 친근한'}
- 타겟 독자: ${post.audience || '일반 독자'}

**작성 요구사항:**
1. SEO 최적화된 구조 (H1, H2, H3 헤딩 사용)
2. 독자 참여를 유도하는 매력적인 내용
3. 실용적인 정보와 구체적 예시 제공
4. ${post.tone || '전문적이면서 친근한'} 톤으로 작성
5. 목표 길이 ${post.targetLength || 1500}자 내외로 작성
6. 한국어로 작성하며, 읽기 쉽고 이해하기 쉬운 문체 사용

마크다운 형식으로 작성해주세요.
`

      const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: geminiPrompt }]
          }],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 2048,
          }
        })
      })

      if (!geminiResponse.ok) {
        const errorData = await geminiResponse.text()
        console.error('Gemini API Error:', errorData)
        throw new Error(`Gemini API 오류 (${geminiResponse.status}): API 키를 확인해주세요.`)
      }

      const geminiData = await geminiResponse.json()
      const content = geminiData.candidates?.[0]?.content?.parts?.[0]?.text

      if (!content) {
        throw new Error('Gemini API에서 콘텐츠를 생성하지 못했습니다.')
      }

      post.content = content
      post.wordCount = content.length
      post.status = 'completed'
      post.generatedAt = new Date().toISOString()
      post.updatedAt = new Date().toISOString()
      
      return c.json({ 
        success: true, 
        message: 'AI가 고품질 블로그 글을 성공적으로 생성했습니다!',
        post 
      })
      
    } catch (apiError: any) {
      console.error('Gemini API Error:', apiError)
      post.status = 'error'
      
      return c.json({ 
        success: false, 
        message: apiError.message || 'AI 콘텐츠 생성 중 오류가 발생했습니다.',
        error: 'GEMINI_API_ERROR'
      }, 500)
    }
    
  } catch (error: any) {
    console.error('Generation error:', error)
    post.status = 'error'
    
    return c.json({
      success: false,
      message: error.message || '글 생성 중 오류가 발생했습니다.',
      error: 'GENERATION_ERROR'
    }, 500)
  }
})

// Drive 저장 (데모)
app.post('/api/demo/save/:postId', async (c) => {
  const postId = c.req.param('postId')
  const post = blogPosts.find(p => p.id === postId)
  
  if (!post || !post.content) {
    return c.json({ success: false, message: '저장할 글을 찾을 수 없습니다.' }, 404)
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  post.driveFileId = 'demo_drive_' + Date.now()
  post.updatedAt = new Date().toISOString()
  
  return c.json({ 
    success: true, 
    message: 'Drive 저장 완료! (데모)',
    fileId: post.driveFileId 
  })
})

// 작업 파이프라인 스텁
app.post('/api/jobs/trigger-from-sheets', async (c) => {
  // 실제 구현: Sheets 읽기 → 대상 행 선택 → generation_jobs 삽입
  const limit = Number(new URL(c.req.url).searchParams.get('limit') || 3)
  const queued = blogPosts.filter(p => p.status === 'pending').slice(0, limit)
  queued.forEach(p => processingQueue.push(p.id))
  return c.json({ queued: queued.map(q => q.id), count: queued.length })
})

app.post('/api/jobs/:id/run', async (c) => {
  const id = c.req.param('id')
  if (!blogPosts.find(p => p.id === id)) return c.json({ error: 'not found' }, 404)
  await new Promise(r => setTimeout(r, 500))
  return c.json({ ok: true })
})

export default app
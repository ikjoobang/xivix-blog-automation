// 블로그 자동화 시스템 - 간단한 프론트엔드

// 인증 상태 관리
let currentUser = null;

class BlogSystem {
    constructor() {
        this.init()
    }

    init() {
        // 인증 상태에 따라 다른 데이터 로드
        if (currentUser) {
            this.loadDbStats()
            this.loadDbPosts()
            setInterval(() => {
                this.loadDbStats()
                this.loadDbPosts()
            }, 5000)
        } else {
            this.loadStats()
            this.loadPosts()
            setInterval(() => {
                this.loadStats()
                this.loadPosts()
            }, 3000)
        }
    }

    async loadDbStats() {
        try {
            const response = await axios.get('/api/stats/db')
            const stats = response.data
            
            document.getElementById('total-posts').textContent = stats.total
            document.getElementById('pending-posts').textContent = stats.pending
            document.getElementById('completed-posts').textContent = stats.completed
            document.getElementById('error-posts').textContent = stats.errors
        } catch (error) {
            console.error('DB Stats load error:', error)
            // 폴백으로 메모리 stats 시도
            this.loadStats()
        }
    }

    async loadStats() {
        try {
            const response = await axios.get('/api/stats')
            const stats = response.data
            
            document.getElementById('total-posts').textContent = stats.total
            document.getElementById('pending-posts').textContent = stats.pending
            document.getElementById('completed-posts').textContent = stats.completed
            document.getElementById('error-posts').textContent = stats.errors
        } catch (error) {
            console.error('Stats load error:', error)
        }
    }

    async loadDbPosts() {
        try {
            const response = await axios.get('/api/articles')
            const articles = response.data.articles || []
            
            this.renderDbPosts(articles)
        } catch (error) {
            console.error('DB Posts load error:', error)
            // 폴백으로 메모리 posts 시도
            this.loadPosts()
        }
    }

    async loadPosts() {
        try {
            const response = await axios.get('/api/posts')
            const posts = response.data
            
            this.renderPosts(posts)
        } catch (error) {
            console.error('Posts load error:', error)
        }
    }

    renderDbPosts(articles) {
        const tbody = document.getElementById('posts-table')
        
        if (articles.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="px-6 py-8 text-center text-gray-500">
                        <i class="fas fa-inbox text-3xl mb-2 block"></i>
                        아직 글이 없습니다. "시트 동기화"를 클릭해보세요!
                    </td>
                </tr>
            `
            return
        }

        tbody.innerHTML = articles.map(article => `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4">
                    <div class="font-medium text-gray-900">${article.title}</div>
                    <div class="text-sm text-gray-500">${article.keywords || ''}</div>
                </td>
                <td class="px-6 py-4">
                    <span class="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">${article.topic}</span>
                </td>
                <td class="px-6 py-4">
                    ${this.getStatusBadge(article.status)}
                </td>
                <td class="px-6 py-4">
                    ${this.getDbActionButtons(article)}
                </td>
            </tr>
        `).join('')
    }

    renderPosts(posts) {
        const tbody = document.getElementById('posts-table')
        
        if (posts.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="px-6 py-8 text-center text-gray-500">
                        <i class="fas fa-inbox text-3xl mb-2 block"></i>
                        아직 글이 없습니다. "데모 시작하기"를 클릭해보세요!
                    </td>
                </tr>
            `
            return
        }

        tbody.innerHTML = posts.map(post => `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4">
                    <div class="font-medium text-gray-900">${post.title}</div>
                    <div class="text-sm text-gray-500">${post.keywords.join(', ')}</div>
                </td>
                <td class="px-6 py-4">
                    <span class="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">${post.topic}</span>
                </td>
                <td class="px-6 py-4">
                    ${this.getStatusBadge(post.status)}
                </td>
                <td class="px-6 py-4">
                    ${this.getActionButtons(post)}
                </td>
            </tr>
        `).join('')
    }

    getStatusBadge(status) {
        const badges = {
            pending: '<span class="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800"><i class="fas fa-clock mr-1"></i>대기중</span>',
            processing: '<span class="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800"><i class="fas fa-spinner fa-spin mr-1"></i>처리중</span>',
            completed: '<span class="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800"><i class="fas fa-check mr-1"></i>완료</span>',
            error: '<span class="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800"><i class="fas fa-times mr-1"></i>오류</span>'
        }
        return badges[status] || badges.pending
    }

    getDbActionButtons(article) {
        if (article.status === 'pending') {
            return `<button onclick="runJob('${article.id}')" class="text-blue-600 hover:text-blue-800">생성</button>`
        } else if (article.status === 'completed') {
            return `
                <button onclick="viewDbArticle('${article.id}')" class="text-green-600 hover:text-green-800 mr-2">보기</button>
                <button onclick="saveToDrive('${article.id}')" class="text-purple-600 hover:text-purple-800">Drive 저장</button>
            `
        }
        return '<span class="text-gray-400">처리중...</span>'
    }

    getActionButtons(post) {
        if (post.status === 'pending') {
            return `<button onclick="generatePost('${post.id}')" class="text-blue-600 hover:text-blue-800">생성</button>`
        } else if (post.status === 'completed') {
            return `
                <button onclick="viewPost('${post.id}')" class="text-green-600 hover:text-green-800 mr-2">보기</button>
                ${post.driveFileId ? 
                    '<span class="text-gray-400">저장됨</span>' :
                    `<button onclick="savePost('${post.id}')" class="text-purple-600 hover:text-purple-800">저장</button>`
                }
            `
        }
        return '<span class="text-gray-400">처리중...</span>'
    }

    showAlert(message, type = 'info') {
        // 간단한 알림 시스템
        const alertDiv = document.createElement('div')
        alertDiv.className = `fixed top-4 right-4 p-4 rounded-lg text-white z-50 ${
            type === 'success' ? 'bg-green-500' : 
            type === 'error' ? 'bg-red-500' : 'bg-blue-500'
        }`
        alertDiv.textContent = message
        document.body.appendChild(alertDiv)
        
        setTimeout(() => {
            alertDiv.remove()
        }, 3000)
    }
}

// 전역 함수들
async function quickStart() {
    try {
        blogSystem.showAlert('데모 데이터를 로드하고 있습니다...', 'info')
        
        const response = await axios.post('/api/demo/init')
        
        if (response.data.success) {
            blogSystem.showAlert('데모 데이터 로드 완료!', 'success')
        }
    } catch (error) {
        blogSystem.showAlert('데모 로드 실패', 'error')
    }
}

async function generatePost(postId) {
    try {
        blogSystem.showAlert('글을 생성하고 있습니다...', 'info')
        
        const response = await axios.post(`/api/demo/generate/${postId}`)
        
        if (response.data.success) {
            blogSystem.showAlert('글 생성 완료!', 'success')
        }
    } catch (error) {
        blogSystem.showAlert('글 생성 실패', 'error')
    }
}

async function savePost(postId) {
    try {
        blogSystem.showAlert('Drive에 저장하고 있습니다...', 'info')
        
        const response = await axios.post(`/api/demo/save/${postId}`)
        
        if (response.data.success) {
            blogSystem.showAlert('Drive 저장 완료!', 'success')
        }
    } catch (error) {
        blogSystem.showAlert('저장 실패', 'error')
    }
}

async function viewPost(postId) {
    try {
        const response = await axios.get('/api/posts')
        const post = response.data.find(p => p.id === postId)
        
        if (post && post.content) {
            const modal = document.createElement('div')
            modal.className = 'fixed inset-0 bg-gray-600 bg-opacity-50 z-50 flex items-center justify-center p-4'
            modal.innerHTML = `
                <div class="bg-white rounded-lg max-w-4xl w-full max-h-96 overflow-y-auto p-6">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-bold">${post.title}</h3>
                        <button onclick="this.parentElement.parentElement.parentElement.remove()" class="text-gray-500 hover:text-gray-700">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <pre class="whitespace-pre-wrap text-sm text-gray-700">${post.content}</pre>
                </div>
            `
            document.body.appendChild(modal)
        }
    } catch (error) {
        blogSystem.showAlert('글 보기 실패', 'error')
    }
}

// 연결 테스트 함수들 (간단 버전)
function testSheetsConnection() {
    blogSystem.showAlert('Sheets 연결 테스트 (데모)', 'success')
}

function testGeminiConnection() {
    blogSystem.showAlert('Gemini 연결 테스트 (데모)', 'success')
}

function testDriveConnection() {
    blogSystem.showAlert('Drive 연결 테스트 (데모)', 'success')
}

// 인증 상태 확인
async function checkAuthStatus() {
    try {
        const response = await axios.get('/auth/me')
        if (response.data.authenticated) {
            currentUser = response.data.user
            showAuthenticatedUI()
        } else {
            currentUser = null
            showUnauthenticatedUI()
        }
    } catch (error) {
        currentUser = null
        showUnauthenticatedUI()
    }
}

function showAuthenticatedUI() {
    document.getElementById('auth-status').innerHTML = `
        <i class="fas fa-check-circle text-green-600 mr-1"></i>
        <span class="text-green-600">로그인됨: ${currentUser.name} (${currentUser.role})</span>
        <button onclick="logout()" class="ml-2 text-red-600 hover:text-red-800 text-sm">로그아웃</button>
    `
    document.getElementById('auth-section').style.display = 'none'
    document.getElementById('control-section').style.display = 'block'
    document.getElementById('demo-section').style.display = 'none'
}

function showUnauthenticatedUI() {
    document.getElementById('auth-status').innerHTML = `
        <i class="fas fa-exclamation-triangle text-orange-500 mr-1"></i>
        <span class="text-orange-600">로그인이 필요합니다</span>
    `
    document.getElementById('auth-section').style.display = 'block'
    document.getElementById('control-section').style.display = 'none'
    document.getElementById('demo-section').style.display = 'block'
}

// 로그아웃
async function logout() {
    try {
        await axios.post('/auth/logout')
        currentUser = null
        showUnauthenticatedUI()
        blogSystem.showAlert('로그아웃되었습니다', 'success')
    } catch (error) {
        blogSystem.showAlert('로그아웃 실패', 'error')
    }
}

// 시트 동기화
async function syncFromSheets() {
    try {
        blogSystem.showAlert('시트에서 데이터를 가져오는 중...', 'info')
        const response = await axios.post('/api/sheets/sync')
        if (response.data.success) {
            blogSystem.showAlert(`${response.data.newSynced}개 새 글을 동기화했습니다`, 'success')
            blogSystem.loadDbPosts() // 목록 새로고침
        }
    } catch (error) {
        blogSystem.showAlert('시트 동기화 실패: ' + (error.response?.data?.error || error.message), 'error')
    }
}

// 작업 트리거
async function triggerJobs() {
    try {
        blogSystem.showAlert('작업을 시작하는 중...', 'info')
        const response = await axios.post('/api/jobs/trigger-from-sheets?limit=3')
        if (response.data.success) {
            blogSystem.showAlert(`${response.data.jobs.length}개 작업이 대기열에 추가되었습니다`, 'success')
        }
    } catch (error) {
        blogSystem.showAlert('작업 시작 실패: ' + (error.response?.data?.error || error.message), 'error')
    }
}

// 개별 작업 실행
async function runJob(articleId) {
    try {
        blogSystem.showAlert('글을 생성하는 중...', 'info')
        // 작업 ID 찾기 (간단화를 위해 articleId 사용)
        const response = await axios.post(`/api/jobs/${articleId}/run`)
        if (response.data.success) {
            blogSystem.showAlert('글 생성이 완료되었습니다!', 'success')
            blogSystem.loadDbPosts() // 목록 새로고침
        }
    } catch (error) {
        blogSystem.showAlert('글 생성 실패: ' + (error.response?.data?.error || error.message), 'error')
    }
}

// 작업 현황 보기
async function showJobs() {
    try {
        const response = await axios.get('/api/jobs?limit=10')
        const jobs = response.data.jobs || []
        
        let jobsHtml = jobs.map(job => `
            <div class="mb-2 p-2 border rounded">
                <div class="font-medium">${job.title}</div>
                <div class="text-sm text-gray-600">
                    상태: ${job.status} | 시도: ${job.attempt}회 | 생성: ${job.created_at}
                </div>
            </div>
        `).join('')
        
        if (jobs.length === 0) {
            jobsHtml = '<div class="text-gray-500">진행 중인 작업이 없습니다.</div>'
        }
        
        const modal = document.createElement('div')
        modal.className = 'fixed inset-0 bg-gray-600 bg-opacity-50 z-50 flex items-center justify-center p-4'
        modal.innerHTML = `
            <div class="bg-white rounded-lg max-w-2xl w-full max-h-96 overflow-y-auto p-6">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-bold">작업 현황</h3>
                    <button onclick="this.parentElement.parentElement.parentElement.remove()" class="text-gray-500 hover:text-gray-700">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div>${jobsHtml}</div>
            </div>
        `
        document.body.appendChild(modal)
        
    } catch (error) {
        blogSystem.showAlert('작업 현황 조회 실패', 'error')
    }
}

// DB 글 보기
async function viewDbArticle(articleId) {
    try {
        const response = await axios.get('/api/articles')
        const article = response.data.articles.find(a => a.id == articleId)
        
        if (article && article.content) {
            const modal = document.createElement('div')
            modal.className = 'fixed inset-0 bg-gray-600 bg-opacity-50 z-50 flex items-center justify-center p-4'
            modal.innerHTML = `
                <div class="bg-white rounded-lg max-w-4xl w-full max-h-96 overflow-y-auto p-6">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-bold">${article.title}</h3>
                        <button onclick="this.parentElement.parentElement.parentElement.remove()" class="text-gray-500 hover:text-gray-700">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <pre class="whitespace-pre-wrap text-sm text-gray-700">${article.content}</pre>
                </div>
            `
            document.body.appendChild(modal)
        } else {
            blogSystem.showAlert('글 내용이 없습니다', 'error')
        }
    } catch (error) {
        blogSystem.showAlert('글 보기 실패', 'error')
    }
}

// Drive 저장 (향후 구현)
async function saveToDrive(articleId) {
    blogSystem.showAlert('Drive 저장 기능은 구현 예정입니다', 'info')
}

// 시스템 초기화
const blogSystem = new BlogSystem()
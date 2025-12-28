/* =========================================
   보안 스크립트 - 해킹방지 및 보호 기능
   ========================================= */

// 전역 보안 설정
(function() {
    'use strict';
    
    // 개발자 도구 감지 및 차단
    let devtools = { open: false };
    const threshold = 160;
    
    setInterval(() => {
        if (window.outerHeight - window.innerHeight > threshold || 
            window.outerWidth - window.innerWidth > threshold) {
            if (!devtools.open) {
                devtools.open = true;
                console.clear();
                document.body.innerHTML = `
                    <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;z-index:999999;">
                        <div style="text-align:center;">
                            <h1>⚠️ 개발자 도구 감지됨</h1>
                            <p>보안상 개발자 도구를 닫아주세요.</p>
                            <button onclick="location.reload()" style="padding:10px 20px;background:#03C75A;color:#fff;border:none;border-radius:5px;cursor:pointer;">새로고침</button>
                        </div>
                    </div>
                `;
            }
        } else {
            devtools.open = false;
        }
    }, 500);
    
    // 우클릭 방지
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        showSecurityAlert('우클릭이 차단되었습니다.');
        return false;
    });
    
    // 키보드 단축키 차단
    document.addEventListener('keydown', function(e) {
        // F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U
        if (e.key === 'F12' || 
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) ||
            (e.ctrlKey && e.key === 'U') ||
            (e.ctrlKey && e.key === 'S') ||  // 저장 방지
            (e.ctrlKey && e.key === 'A' && !e.target.classList.contains('result-copyable'))) {  // 전체 선택 방지 (결과물 제외)
            e.preventDefault();
            showSecurityAlert('해당 기능이 차단되었습니다.');
            return false;
        }
    });
    
    // 드래그 방지
    document.addEventListener('dragstart', function(e) {
        if (!e.target.classList.contains('result-copyable')) {
            e.preventDefault();
            return false;
        }
    });
    
    // 인쇄 방지
    window.addEventListener('beforeprint', function(e) {
        e.preventDefault();
        showSecurityAlert('인쇄 기능이 차단되었습니다.');
        return false;
    });
    
    // 텍스트 선택 방지 (결과물 제외)
    document.addEventListener('selectstart', function(e) {
        if (!e.target.classList.contains('result-copyable') && 
            !e.target.tagName.match(/INPUT|TEXTAREA/) &&
            !e.target.classList.contains('editable')) {
            e.preventDefault();
            return false;
        }
    });
    
})();

// 사용량 제한 관리
class UsageLimiter {
    constructor() {
        this.maxDaily = 3;
        this.storageKey = 'blog_automation_usage';
    }
    
    getTodayUsage() {
        const today = new Date().toDateString();
        const usage = JSON.parse(localStorage.getItem(this.storageKey) || '{}');
        
        // 날짜가 바뀌면 초기화
        if (usage.date !== today) {
            const newUsage = { date: today, count: 0 };
            localStorage.setItem(this.storageKey, JSON.stringify(newUsage));
            return newUsage;
        }
        
        return usage;
    }
    
    canUse() {
        const usage = this.getTodayUsage();
        return usage.count < this.maxDaily;
    }
    
    incrementUsage() {
        const usage = this.getTodayUsage();
        if (this.canUse()) {
            usage.count++;
            localStorage.setItem(this.storageKey, JSON.stringify(usage));
            this.updateUsageDisplay();
            return true;
        }
        return false;
    }
    
    getRemainingUsage() {
        const usage = this.getTodayUsage();
        return Math.max(0, this.maxDaily - usage.count);
    }
    
    updateUsageDisplay() {
        const usage = this.getTodayUsage();
        const remaining = this.getRemainingUsage();
        const percentage = (usage.count / this.maxDaily) * 100;
        
        const displayElement = document.getElementById('usage-display');
        if (displayElement) {
            displayElement.innerHTML = `
                <div class="usage-info">
                    <span class="usage-text">오늘 사용량: ${usage.count}/${this.maxDaily}회 (${remaining}회 남음)</span>
                    <div class="usage-limit-bar">
                        <div class="usage-progress" style="width: ${percentage}%"></div>
                    </div>
                </div>
            `;
        }
    }
}

// API 키 관리
class SecureApiKeyManager {
    constructor() {
        this.storageKey = 'gemini_api_key_encrypted';
        this.encryptionKey = this.generateDeviceKey();
    }
    
    generateDeviceKey() {
        // 디바이스 고유 키 생성 (localStorage 기반)
        let deviceKey = localStorage.getItem('device_key');
        if (!deviceKey) {
            deviceKey = this.generateRandomKey();
            localStorage.setItem('device_key', deviceKey);
        }
        return deviceKey;
    }
    
    generateRandomKey() {
        return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    }
    
    encrypt(text) {
        // 간단한 XOR 암호화 (실제 서비스에서는 더 강력한 암호화 사용)
        let result = '';
        for (let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ this.encryptionKey.charCodeAt(i % this.encryptionKey.length));
        }
        return btoa(result);
    }
    
    decrypt(encryptedText) {
        try {
            const text = atob(encryptedText);
            let result = '';
            for (let i = 0; i < text.length; i++) {
                result += String.fromCharCode(text.charCodeAt(i) ^ this.encryptionKey.charCodeAt(i % this.encryptionKey.length));
            }
            return result;
        } catch (e) {
            return null;
        }
    }
    
    saveApiKey(apiKey) {
        if (!this.validateApiKey(apiKey)) {
            throw new Error('유효하지 않은 API 키 형식입니다.');
        }
        
        const encrypted = this.encrypt(apiKey);
        localStorage.setItem(this.storageKey, encrypted);
        this.updateKeyDisplay(true);
    }
    
    getApiKey() {
        const encrypted = localStorage.getItem(this.storageKey);
        if (!encrypted) return null;
        
        return this.decrypt(encrypted);
    }
    
    validateApiKey(apiKey) {
        // Gemini API 키 형식 검증
        return apiKey && typeof apiKey === 'string' && apiKey.length > 20 && apiKey.startsWith('AI');
    }
    
    clearApiKey() {
        localStorage.removeItem(this.storageKey);
        this.updateKeyDisplay(false);
    }
    
    updateKeyDisplay(hasKey) {
        const statusElement = document.getElementById('api-key-status');
        const inputElement = document.getElementById('gemini-api-key');
        
        if (statusElement) {
            if (hasKey) {
                statusElement.innerHTML = `
                    <div class="success-message">
                        <i class="fas fa-check-circle mr-2"></i>
                        Gemini API 키가 안전하게 저장되었습니다.
                        <button onclick="apiKeyManager.clearApiKey()" class="ml-2 text-red-600 underline">삭제</button>
                    </div>
                `;
            } else {
                statusElement.innerHTML = `
                    <div class="error-message">
                        <i class="fas fa-exclamation-triangle mr-2"></i>
                        Gemini API 키를 입력해주세요.
                    </div>
                `;
            }
        }
        
        if (inputElement && hasKey) {
            inputElement.value = '';
            inputElement.placeholder = 'API 키가 저장되었습니다';
        }
    }
    
    hasValidKey() {
        const apiKey = this.getApiKey();
        return apiKey && this.validateApiKey(apiKey);
    }
}

// 복사 기능
function copyToClipboard(text, buttonElement) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showCopySuccess(buttonElement);
        }).catch(() => {
            fallbackCopy(text, buttonElement);
        });
    } else {
        fallbackCopy(text, buttonElement);
    }
}

function fallbackCopy(text, buttonElement) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        document.execCommand('copy');
        showCopySuccess(buttonElement);
    } catch (err) {
        showSecurityAlert('복사 실패: ' + err.message);
    } finally {
        textArea.remove();
    }
}

function showCopySuccess(buttonElement) {
    const originalText = buttonElement.innerHTML;
    buttonElement.innerHTML = '<i class="fas fa-check"></i> 복사됨!';
    buttonElement.classList.add('copied');
    
    setTimeout(() => {
        buttonElement.innerHTML = originalText;
        buttonElement.classList.remove('copied');
    }, 2000);
}

// 로딩 오버레이
function showLoadingOverlay(message = '처리 중...') {
    const overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
        <div style="text-align: center; color: white;">
            <div class="loading-spinner"></div>
            <div style="margin-top: 16px; font-size: 18px; font-weight: 600;">${message}</div>
        </div>
    `;
    document.body.appendChild(overlay);
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.remove();
    }
}

// 보안 알림
function showSecurityAlert(message) {
    const alert = document.createElement('div');
    alert.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #ff6b6b, #ffd93d);
        color: #721c24;
        padding: 12px 16px;
        border-radius: 8px;
        font-weight: 600;
        z-index: 999999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    `;
    alert.innerHTML = `<i class="fas fa-shield-alt mr-2"></i>${message}`;
    
    document.body.appendChild(alert);
    
    setTimeout(() => {
        alert.remove();
    }, 3000);
}

// 전역 인스턴스 생성
const usageLimiter = new UsageLimiter();
const apiKeyManager = new SecureApiKeyManager();

// 초기화
document.addEventListener('DOMContentLoaded', function() {
    usageLimiter.updateUsageDisplay();
    apiKeyManager.updateKeyDisplay(apiKeyManager.hasValidKey());
    
    // API 키 입력 이벤트
    const apiKeyInput = document.getElementById('gemini-api-key');
    if (apiKeyInput) {
        apiKeyInput.addEventListener('blur', function() {
            const apiKey = this.value.trim();
            if (apiKey) {
                try {
                    apiKeyManager.saveApiKey(apiKey);
                    showSuccessMessage('API 키가 성공적으로 저장되었습니다!');
                } catch (error) {
                    showErrorMessage(error.message);
                }
            }
        });
    }
});

// 메시지 표시 함수들
function showErrorMessage(message) {
    const container = document.getElementById('message-container') || document.body;
    const div = document.createElement('div');
    div.className = 'error-message';
    div.innerHTML = `<i class="fas fa-exclamation-triangle mr-2"></i>${message}`;
    container.appendChild(div);
    
    setTimeout(() => div.remove(), 5000);
}

function showSuccessMessage(message) {
    const container = document.getElementById('message-container') || document.body;
    const div = document.createElement('div');
    div.className = 'success-message';
    div.innerHTML = `<i class="fas fa-check-circle mr-2"></i>${message}`;
    container.appendChild(div);
    
    setTimeout(() => div.remove(), 5000);
}
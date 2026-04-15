
import { t } from './i18n.js';

const TUTORIAL_KEY = 'ohmypieno_tutorial_seen';

export function checkTutorial() {
    const seen = localStorage.getItem(TUTORIAL_KEY);
    if (!seen) {
        startTutorial();
    }
}

function startTutorial() {
    const overlay = document.createElement('div');
    overlay.id = 'tutorial-overlay';
    overlay.innerHTML = `
        <div class="tutorial-modal">
            <div class="tutorial-progress">
                <span class="dot active"></span>
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </div>
            <h2 id="tutorial-title">${t('tutorial_title')}</h2>
            <p id="tutorial-text">${t('tutorial_step1')}</p>
            <div class="tutorial-actions">
                <button id="tutorial-skip" class="btn-text">${t('btn_skip')}</button>
                <button id="tutorial-next" class="btn-primary">${t('btn_next')}</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    let currentStep = 1;
    const totalSteps = 4;

    const nextBtn = overlay.querySelector('#tutorial-next');
    const skipBtn = overlay.querySelector('#tutorial-skip');
    const dots = overlay.querySelectorAll('.dot');
    const text = overlay.querySelector('#tutorial-text');

    const updateStep = () => {
        text.textContent = t(`tutorial_step${currentStep}`);
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === currentStep - 1);
        });
        
        if (currentStep === totalSteps) {
            nextBtn.textContent = t('btn_finish');
        } else {
            nextBtn.textContent = t('btn_next');
        }
    };

    nextBtn.addEventListener('click', () => {
        if (currentStep < totalSteps) {
            currentStep++;
            updateStep();
        } else {
            finishTutorial();
        }
    });

    skipBtn.addEventListener('click', finishTutorial);

    function finishTutorial() {
        localStorage.setItem(TUTORIAL_KEY, 'true');
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.remove(), 300);
    }
}

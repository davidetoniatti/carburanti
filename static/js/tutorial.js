import { t } from './i18n.js';
import { TUTORIAL_STEPS } from './constants.js';

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
            <div class="tutorial-progress" id="tutorial-dots">
                <!-- Dots generated dynamically -->
            </div>
            <h2 id="tutorial-title">${t('tutorial_title')} OHMY<em>PIENO</em></h2>
            <p id="tutorial-text"></p>
            <div class="tutorial-actions">
                <button id="tutorial-back" class="btn-text">${t('btn_back')}</button>
                <div class="spacer"></div>
                <button id="tutorial-skip" class="btn-text">${t('btn_skip')}</button>
                <button id="tutorial-next" class="btn-primary"></button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    let currentIndex = 0;
    const totalSteps = TUTORIAL_STEPS.length;

    const nextBtn = overlay.querySelector('#tutorial-next');
    const backBtn = overlay.querySelector('#tutorial-back');
    const skipBtn = overlay.querySelector('#tutorial-skip');
    const dotsContainer = overlay.querySelector('#tutorial-dots');
    const textField = overlay.querySelector('#tutorial-text');

    // Generate dots
    TUTORIAL_STEPS.forEach(() => {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dotsContainer.appendChild(dot);
    });
    const dots = dotsContainer.querySelectorAll('.dot');

    const updateUI = () => {
        const step = TUTORIAL_STEPS[currentIndex];

        // Update Text
        textField.textContent = t(step.textKey);

        // Update Dots
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === currentIndex);
        });

        // Update Buttons
        backBtn.classList.toggle('hidden', currentIndex === 0);
        nextBtn.textContent = (currentIndex === totalSteps - 1) ? t('btn_finish') : t('btn_next');

        // Update Highlights
        document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
        if (step.highlight) {
            const els = document.querySelectorAll(step.highlight);
            els.forEach(el => el.classList.add('tutorial-highlight'));
        }
    };

    nextBtn.addEventListener('click', () => {
        if (currentIndex < totalSteps - 1) {
            currentIndex++;
            updateUI();
        } else {
            finishTutorial();
        }
    });

    backBtn.addEventListener('click', () => {
        if (currentIndex > 0) {
            currentIndex--;
            updateUI();
        }
    });

    skipBtn.addEventListener('click', finishTutorial);

    function finishTutorial() {
        document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
        localStorage.setItem(TUTORIAL_KEY, 'true');
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.remove(), 300);
    }

    // Initial render
    updateUI();
}

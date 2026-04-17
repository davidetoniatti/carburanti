import { t } from './i18n.js';
import { TUTORIAL_STEPS } from './constants.js';

const TUTORIAL_KEY = 'ohmypieno_tutorial_seen';
const FOCUSABLE_SELECTOR = 'button, [href], [tabindex]:not([tabindex="-1"])';

export function checkTutorial() {
    if (localStorage.getItem(TUTORIAL_KEY) === 'true') return;
    startTutorial();
}

export function startTutorial() {
    if (document.getElementById('tutorial-overlay')) return;

    const previouslyFocused = document.activeElement;

    const overlay = document.createElement('div');
    overlay.id = 'tutorial-overlay';

    const modal = document.createElement('div');
    modal.className = 'tutorial-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'tutorial-title');
    modal.setAttribute('aria-describedby', 'tutorial-text');
    modal.tabIndex = -1;

    const dotsContainer = document.createElement('div');
    dotsContainer.className = 'tutorial-progress';
    dotsContainer.id = 'tutorial-dots';

    const title = document.createElement('h2');
    title.id = 'tutorial-title';
    const em = document.createElement('em');
    em.textContent = 'PIENO';
    title.append(t('tutorial_title') + ' OHMY', em);

    const text = document.createElement('p');
    text.id = 'tutorial-text';
    text.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'tutorial-actions';

    const backBtn = document.createElement('button');
    backBtn.id = 'tutorial-back';
    backBtn.type = 'button';
    backBtn.className = 'btn-text';
    backBtn.textContent = t('btn_back');

    const spacer = document.createElement('div');
    spacer.className = 'spacer';

    const skipBtn = document.createElement('button');
    skipBtn.id = 'tutorial-skip';
    skipBtn.type = 'button';
    skipBtn.className = 'btn-text';
    skipBtn.textContent = t('btn_skip');

    const nextBtn = document.createElement('button');
    nextBtn.id = 'tutorial-next';
    nextBtn.type = 'button';
    nextBtn.className = 'btn-primary';

    actions.append(backBtn, spacer, skipBtn, nextBtn);
    modal.append(dotsContainer, title, text, actions);
    overlay.append(modal);
    document.body.appendChild(overlay);

    TUTORIAL_STEPS.forEach(() => {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dotsContainer.appendChild(dot);
    });
    const dots = dotsContainer.querySelectorAll('.dot');

    let currentIndex = 0;
    const totalSteps = TUTORIAL_STEPS.length;

    const clearHighlights = () => {
        document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
    };

    const updateUI = () => {
        const step = TUTORIAL_STEPS[currentIndex];

        text.textContent = t(step.textKey);

        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === currentIndex);
        });

        backBtn.classList.toggle('hidden', currentIndex === 0);
        nextBtn.textContent = (currentIndex === totalSteps - 1) ? t('btn_finish') : t('btn_next');

        clearHighlights();
        if (step.highlight) {
            document.querySelectorAll(step.highlight).forEach(el => el.classList.add('tutorial-highlight'));
        }
    };

    const finishTutorial = () => {
        clearHighlights();
        localStorage.setItem(TUTORIAL_KEY, 'true');
        document.removeEventListener('keydown', onKeydown, true);
        overlay.classList.add('fade-out');
        const remove = () => {
            overlay.remove();
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                previouslyFocused.focus();
            }
        };
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion) {
            remove();
        } else {
            overlay.addEventListener('transitionend', remove, { once: true });
        }
    };

    const goNext = () => {
        if (currentIndex < totalSteps - 1) {
            currentIndex++;
            updateUI();
        } else {
            finishTutorial();
        }
    };

    const goBack = () => {
        if (currentIndex > 0) {
            currentIndex--;
            updateUI();
        }
    };

    const onKeydown = (e) => {
        if (!overlay.isConnected) return;
        switch (e.key) {
            case 'Escape':
                e.preventDefault();
                finishTutorial();
                return;
            case 'ArrowRight':
                e.preventDefault();
                goNext();
                return;
            case 'ArrowLeft':
                e.preventDefault();
                goBack();
                return;
            case 'Tab': {
                const focusables = modal.querySelectorAll(FOCUSABLE_SELECTOR);
                const visible = Array.from(focusables).filter(el => !el.classList.contains('hidden'));
                if (visible.length === 0) return;
                const first = visible[0];
                const last = visible[visible.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
                return;
            }
        }
    };

    nextBtn.addEventListener('click', goNext);
    backBtn.addEventListener('click', goBack);
    skipBtn.addEventListener('click', finishTutorial);
    document.addEventListener('keydown', onKeydown, true);

    updateUI();
    nextBtn.focus();
}

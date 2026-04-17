import { t } from './i18n.js';
import { TUTORIAL_STEPS, STORAGE_KEYS } from './constants.js';

const FOCUSABLE_SELECTOR = 'button, [href], [tabindex]:not([tabindex="-1"])';

// Set while a tutorial is on screen. Invoked by `refreshTutorialIfActive`
// so language changes during the tutorial re-render its strings in place.
let activeRefresh = null;

export function checkTutorial() {
    if (localStorage.getItem(STORAGE_KEYS.TUTORIAL_SEEN) === 'true') return;
    startTutorial();
}

export function refreshTutorialIfActive() {
    if (activeRefresh) activeRefresh();
}

export function startTutorial() {
    if (document.getElementById('tutorial-overlay')) return;

    const previouslyFocused = document.activeElement;

    const overlay = document.createElement('div');
    overlay.id = 'tutorial-overlay';

    // Spotlight: a dim backdrop with a cutout around the current highlight.
    // The element is the transparent hole; its massive box-shadow creates the
    // surrounding dim. Size 0 == full dim everywhere (used when a step has no
    // highlight).
    const spotlight = document.createElement('div');
    spotlight.className = 'tutorial-spotlight';
    spotlight.setAttribute('aria-hidden', 'true');

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

    const text = document.createElement('p');
    text.id = 'tutorial-text';
    text.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'tutorial-actions';

    const backBtn = document.createElement('button');
    backBtn.id = 'tutorial-back';
    backBtn.type = 'button';
    backBtn.className = 'btn-text';

    const spacer = document.createElement('div');
    spacer.className = 'spacer';

    const skipBtn = document.createElement('button');
    skipBtn.id = 'tutorial-skip';
    skipBtn.type = 'button';
    skipBtn.className = 'btn-text';

    const nextBtn = document.createElement('button');
    nextBtn.id = 'tutorial-next';
    nextBtn.type = 'button';
    nextBtn.className = 'btn-primary';

    actions.append(backBtn, spacer, skipBtn, nextBtn);
    modal.append(dotsContainer, title, text, actions);
    // spotlight first so modal naturally stacks on top via DOM order.
    overlay.append(spotlight, modal);
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

    const SPOTLIGHT_PADDING = 8;

    const getTargetRect = (selector) => {
        const el = selector ? document.querySelector(selector) : null;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        return rect;
    };

    const updateSpotlight = (rect) => {
        if (!rect) {
            // No target: collapse to a 0×0 point so the box-shadow fills
            // the viewport with a solid dim.
            spotlight.style.top = '0';
            spotlight.style.left = '0';
            spotlight.style.width = '0';
            spotlight.style.height = '0';
            spotlight.style.borderRadius = '0';
            return;
        }
        spotlight.style.top = `${rect.top - SPOTLIGHT_PADDING}px`;
        spotlight.style.left = `${rect.left - SPOTLIGHT_PADDING}px`;
        spotlight.style.width = `${rect.width + SPOTLIGHT_PADDING * 2}px`;
        spotlight.style.height = `${rect.height + SPOTLIGHT_PADDING * 2}px`;
        spotlight.style.borderRadius = '8px';
    };

    const renderTitle = () => {
        title.replaceChildren();
        const em = document.createElement('em');
        em.textContent = 'PIENO';
        title.append(t('tutorial_title') + ' OHMY', em);
    };

    const updateUI = () => {
        const step = TUTORIAL_STEPS[currentIndex];

        renderTitle();
        backBtn.textContent = t('btn_back');
        skipBtn.textContent = t('btn_skip');
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
        updateSpotlight(getTargetRect(step.highlight));
    };

    activeRefresh = updateUI;

    const onResize = () => {
        updateSpotlight(getTargetRect(TUTORIAL_STEPS[currentIndex].highlight));
    };
    window.addEventListener('resize', onResize);

    const finishTutorial = () => {
        clearHighlights();
        activeRefresh = null;
        window.removeEventListener('resize', onResize);
        localStorage.setItem(STORAGE_KEYS.TUTORIAL_SEEN, 'true');
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

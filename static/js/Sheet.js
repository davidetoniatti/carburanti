
/**
 * Sheet.js
 * Unified class to handle both top and bottom sheet interactions.
 */

import { BREAKPOINTS, SHEET_CONFIG } from './constants.js';

export class Sheet {
    constructor(panelId, type = 'bottom') {
        this.panel = document.getElementById(panelId);
        this.type = type; // 'top' or 'bottom'
        if (!this.panel) return;

        this.startY = 0;
        this.isDragging = false;
        this.startTime = 0;

        this.init();
    }

    init() {
        this.panel.addEventListener('pointerdown', (e) => this.onStart(e));
        this.panel.addEventListener('pointermove', (e) => this.onMove(e));
        this.panel.addEventListener('pointerup', (e) => this.onEnd(e));
        this.panel.addEventListener('pointercancel', (e) => this.onEnd(e));
        
        // Prevent default touch actions on the entire panel, except scrolling areas
        this.panel.style.touchAction = 'none';
        
        const scrollable = this.panel.querySelector('.scrollable-content');
        if (scrollable) {
            scrollable.style.touchAction = 'pan-y';
        }
    }

    isMobileView() {
        return window.innerWidth <= BREAKPOINTS.DESKTOP;
    }

    getTargetY() {
        if (this.panel.classList.contains('hidden') || this.panel.classList.contains('mobile-hidden')) {
            return this.type === 'bottom' ? window.innerHeight : -window.innerHeight;
        }
        if (this.panel.classList.contains('full')) return 0;
        if (this.panel.classList.contains('peek')) return window.innerHeight * (SHEET_CONFIG.PEEK_HEIGHT_VH / 100);
        return 0; // Default (e.g., controls is at 0 when shown)
    }

    onStart(e) {
        if (!this.isMobileView()) return;
        if (this.panel.classList.contains('mobile-hidden')) return;

        const isHandle = e.target.closest('.sheet-handle');
        if (isHandle) {
            this.startY = e.clientY;
            this.isDragging = true;
            this.startTime = Date.now();
            this.panel.style.transition = 'none';
            this.panel.setPointerCapture(e.pointerId);
        }
    }

    onMove(e) {
        if (!this.isDragging || !this.isMobileView()) return;

        const deltaY = e.clientY - this.startY;
        let newY = this.getTargetY() + deltaY;

        if (this.type === 'bottom') {
            if (newY < 0) newY = 0; // Clamp bottom sheet at top
            this.panel.style.transform = `translateY(${newY}px)`;
        } else {
            if (deltaY > 0) return; // Don't drag top sheet down past limit
            this.panel.style.transform = `translateY(${deltaY}px)`;
        }

        if (e.cancelable) e.preventDefault();
    }

    onEnd(e) {
        if (!this.isDragging || !this.isMobileView()) return;
        this.isDragging = false;
        
        this.panel.releasePointerCapture(e.pointerId);
        this.panel.style.transition = '';
        this.panel.style.transform = '';

        const deltaY = e.clientY - this.startY;
        const velocity = Math.abs(deltaY) / (Date.now() - this.startTime);
        
        if (this.type === 'bottom') {
            this.handleBottomEnd(deltaY, velocity);
        } else {
            this.handleTopEnd(deltaY, velocity);
        }
    }

    handleBottomEnd(deltaY, velocity) {
        const threshold = SHEET_CONFIG.DRAG_THRESHOLD;
        const currentTarget = this.getTargetY();

        if (currentTarget === 0) { // From FULL
            if (deltaY > threshold || velocity > SHEET_CONFIG.VELOCITY_THRESHOLD) {
                if (deltaY > window.innerHeight * 0.3) this.snapTo('hidden');
                else this.snapTo('peek');
            } else {
                this.snapTo('full');
            }
        } else { // From PEEK
            if (deltaY < -threshold || (deltaY < 0 && velocity > SHEET_CONFIG.VELOCITY_THRESHOLD)) {
                this.snapTo('full');
            } else if (deltaY > threshold || (deltaY > 0 && velocity > SHEET_CONFIG.VELOCITY_THRESHOLD)) {
                this.snapTo('hidden');
            } else {
                this.snapTo('peek');
            }
        }
    }

    handleTopEnd(deltaY, velocity) {
        if (deltaY < -SHEET_CONFIG.DRAG_THRESHOLD || (deltaY < 0 && velocity > SHEET_CONFIG.VELOCITY_THRESHOLD)) {
            this.panel.classList.add('mobile-hidden');
            this.panel.dispatchEvent(new CustomEvent('sheetClosed'));
        }
    }

    snapTo(state) {
        this.panel.classList.remove('peek', 'full', 'hidden');
        this.panel.classList.add(state);
        if (state === 'hidden') {
            this.panel.dispatchEvent(new CustomEvent('sheetClosed'));
        }
    }
}

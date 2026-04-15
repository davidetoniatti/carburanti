
/**
 * BottomSheet.js
 * Handles touch interactions for panels on mobile devices.
 */

const DRAG_THRESHOLD = 50; // px to trigger snap
const MOBILE_BREAKPOINT = 900;

export function initBottomSheet(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  let startTime = 0;

  // Helper to check if we are on mobile
  const isMobile = () => window.innerWidth <= MOBILE_BREAKPOINT;

  // Get current Y position based on CSS classes
  const getTargetY = () => {
    if (panel.classList.contains('hidden')) return window.innerHeight;
    if (panel.classList.contains('full')) return 0;
    return window.innerHeight * 0.5; // peek
  };

  const onTouchStart = (e) => {
    if (!isMobile()) return;

    // Only drag from handle or if content is scrolled to top
    const isHandle = e.target.closest('.sheet-handle');
    const isAtTop = panel.scrollTop <= 0;

    if (isHandle || isAtTop) {
      startY = e.touches[0].clientY;
      currentY = getTargetY();
      isDragging = true;
      startTime = Date.now();
      panel.style.transition = 'none';
    }
  };

  const onTouchMove = (e) => {
    if (!isDragging || !isMobile()) return;

    const touchY = e.touches[0].clientY;
    const deltaY = touchY - startY;
    
    // Don't allow dragging above 'full' (0px) too much
    let newY = getTargetY() + deltaY;
    if (newY < 0) newY = newY * 0.2; 

    panel.style.transform = `translateY(${newY}px)`;

    // Prevent background scrolling when dragging the panel
    if (deltaY > 0 || panel.scrollTop <= 0) {
      if (e.cancelable) e.preventDefault();
    }
  };

  const onTouchEnd = (e) => {
    if (!isDragging || !isMobile()) return;
    isDragging = false;
    
    panel.style.transition = '';
    panel.style.transform = '';

    const endY = e.changedTouches[0].clientY;
    const deltaY = endY - startY;
    const velocity = Math.abs(deltaY) / (Date.now() - startTime);
    
    const currentTarget = getTargetY();

    // Snap logic based on position and velocity
    if (currentTarget === 0) { // From FULL
      if (deltaY > DRAG_THRESHOLD || velocity > 0.5) {
        if (deltaY > window.innerHeight * 0.3) snapTo('hidden');
        else snapTo('peek');
      } else {
        snapTo('full');
      }
    } else if (currentTarget > 0 && currentTarget < window.innerHeight * 0.9) { // From PEEK
      if (deltaY < -DRAG_THRESHOLD || (deltaY < 0 && velocity > 0.5)) {
        snapTo('full');
      } else if (deltaY > DRAG_THRESHOLD || (deltaY > 0 && velocity > 0.5)) {
        snapTo('hidden');
      } else {
        snapTo('peek');
      }
    }
  };

  const snapTo = (state) => {
    panel.classList.remove('peek', 'full', 'hidden');
    panel.classList.add(state);
    
    // Specific cleanup for 'hidden'
    if (state === 'hidden') {
      // Trigger the same logic as close buttons
      if (panelId === 'panel') {
          // We need to call the closePanel from ui.js but avoid circular dependency
          // For now just dispatch an event or rely on the class change
          panel.dispatchEvent(new CustomEvent('sheetClosed'));
      } else if (panelId === 'historyPanel') {
          panel.dispatchEvent(new CustomEvent('sheetClosed'));
      }
    }
  };

  panel.addEventListener('touchstart', onTouchStart, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd);
}

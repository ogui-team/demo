export function createClosablePanel(rootElement: HTMLElement): () => void {
  if (!rootElement.style.position || rootElement.style.position === 'static') {
    rootElement.style.position = 'relative';
  }

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '✕';
  closeButton.style.cssText = `
    position:absolute;
    top:10px;
    right:10px;
    width:30px;
    height:30px;
    border:none;
    border-radius:50%;
    background:rgba(18,18,18,0.92);
    color:#f0f0f0;
    font-size:16px;
    cursor:pointer;
    z-index:10001;
    box-shadow:0 0 0 1px rgba(255,255,255,0.05);
  `;

  const onClose = (): void => {
    rootElement.style.display = 'none';
  };

  const clickHandler = (event: MouseEvent): void => {
    if (event.target === closeButton) {
      event.preventDefault();
      onClose();
    }
  };

  const overlayClickHandler = (event: MouseEvent): void => {
    if (event.target === rootElement) {
      event.preventDefault();
      onClose();
    }
  };

  const escHandler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  closeButton.addEventListener('click', clickHandler);
  rootElement.addEventListener('mousedown', overlayClickHandler);
  window.addEventListener('keydown', escHandler, true);
  rootElement.appendChild(closeButton);

  const dispose = (): void => {
    closeButton.removeEventListener('click', clickHandler);
    rootElement.removeEventListener('mousedown', overlayClickHandler);
    window.removeEventListener('keydown', escHandler, true);
    if (closeButton.parentElement) {
      closeButton.parentElement.removeChild(closeButton);
    }
  };

  return dispose;
}

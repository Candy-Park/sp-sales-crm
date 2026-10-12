// Visual preference only: does not access CRM sessions, mail, or storage.
export function initGlassTheme({root, controls}) {
  if (!root || !controls) return null;
  const existing = controls.querySelector('#crm-glass-toggle');
  if (existing) return existing;
  root.classList.add('crm-frosted');
  const button = controls.ownerDocument.createElement('button');
  button.id = 'crm-glass-toggle';
  button.type = 'button';
  button.className = 'glass-toggle';
  button.setAttribute('aria-label', '유리 효과');
  const update = enabled => {
    root.dataset.glass = enabled ? 'on' : 'off';
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? '유리 효과 끄기' : '유리 효과 켜기';
  };
  update(true);
  button.addEventListener('click', () => update(root.dataset.glass !== 'on'));
  controls.append(button);
  return button;
}

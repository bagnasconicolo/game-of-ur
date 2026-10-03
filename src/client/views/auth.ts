import { h } from '../ui/dom.ts';
import { session } from '../session.ts';
import { navigate } from '../ui/nav.ts';

export async function renderAuth(main: HTMLElement, back: string) {
  if (session.user) {
    navigate(back.startsWith('#/') ? back : '#/gioca');
    return () => {};
  }
  let mode: 'login' | 'register' = 'login';
  const err = h('p', { class: 'error', role: 'alert' });
  const user = h('input', { type: 'text', id: 'auth-user', name: 'username', autocomplete: 'username', required: true, minlength: 3, maxlength: 20, pattern: '[A-Za-z0-9_.\\-]{3,20}' });
  const pass = h('input', { type: 'password', id: 'auth-pass', name: 'password', autocomplete: 'current-password', required: true, minlength: 8 });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Accedi');
  const title = h('h1', null, 'Accedi');
  const hint = h('p', { class: 'small muted', id: 'auth-hint' }, 'Lo username è pubblico e univoco (3–20 caratteri: lettere, cifre, . _ -). La password, di almeno 8 caratteri, non viene mai conservata in chiaro.');
  const toggle = h('button', { class: 'btn ghost', type: 'button' }, 'Non hai un account? Registrati');
  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'auth-user' }, 'Username'), user),
    h('div', { class: 'field' }, h('label', { for: 'auth-pass' }, 'Password'), pass),
    hint, err, h('div', { class: 'row' }, submit, toggle));
  const setMode = (m: typeof mode) => {
    mode = m;
    title.textContent = m === 'login' ? 'Accedi' : 'Crea un account';
    submit.textContent = m === 'login' ? 'Accedi' : 'Registrati';
    toggle.textContent = m === 'login' ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi';
    pass.setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    err.textContent = '';
  };
  toggle.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (mode === 'register' && !/^[A-Za-z0-9_.-]{3,20}$/.test(user.value)) return (err.textContent = 'Username non valido: 3–20 caratteri fra lettere, cifre, punto, trattino e trattino basso.');
    if (mode === 'register' && pass.value.length < 8) return (err.textContent = 'La password deve avere almeno 8 caratteri.');
    submit.setAttribute('disabled', '');
    try {
      if (mode === 'login') await session.login(user.value, pass.value);
      else await session.register(user.value, pass.value);
      navigate(back.startsWith('#/') && !back.startsWith('#/accedi') ? back : '#/gioca');
    } catch (ex) {
      err.textContent = (ex as Error).message;
    } finally {
      submit.removeAttribute('disabled');
    }
  });
  main.append(h('section', { class: 'card', style: 'max-width:480px;margin:32px auto' }, title,
    h('p', { class: 'muted' }, 'Un account serve per giocare online, avere amici, classifiche e salvare le partite sul server. Per giocare sullo stesso dispositivo come ospite non serve.'),
    form));
  user.focus();
  return () => {};
}

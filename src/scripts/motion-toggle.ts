// Site-wide motion switch. The `no-motion` class on <html> is set early by an inline script in
// Layout.astro; this wires up the toggle cards and tells other scripts when it changes.
const root = document.documentElement;
const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-motion-toggle]'));

const sync = () => {
    const on = !root.classList.contains('no-motion');
    buttons.forEach((button) => {
        button.setAttribute('aria-pressed', String(!on));
        button.dataset.state = on ? 'on' : 'off';
        const status = button.querySelector<HTMLElement>('[data-motion-status]');
        if (status) status.textContent = on ? 'Motion on' : 'Motion off';
    });
};

buttons.forEach((button) =>
    button.addEventListener('click', () => {
        const off = root.classList.toggle('no-motion');
        try {
            localStorage.setItem('motion', off ? 'off' : 'on');
        } catch {}
        sync();
        document.dispatchEvent(new CustomEvent('motionchange', { detail: { off } }));
    }),
);

sync();

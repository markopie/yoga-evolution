import { readPreference, setPreference } from '../services/profilePreferences.js';

const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';

class ThemeManager {
    constructor() {
        this.currentTheme = null;
        this.button = null;
        this.systemPreference = null;
        this.userId = null;
    }

    init(userId = null) {
        this.userId = userId;
        this.systemPreference = window.matchMedia('(prefers-color-scheme: dark)');

        const savedTheme = this.loadTheme();
        this.applyTheme(savedTheme);

        this.systemPreference.addEventListener('change', (e) => {
            if (!readPreference('theme', null)) {
                this.applyTheme(e.matches ? THEME_DARK : THEME_LIGHT);
            }
        });

        this.createToggleButton();
    }

    loadTheme() {
        const localTheme = readPreference('theme', null);
        if (localTheme) {
            return localTheme;
        }

        const prefersDark = this.systemPreference?.matches
            ?? window.matchMedia('(prefers-color-scheme: dark)').matches;
        return prefersDark ? THEME_DARK : THEME_LIGHT;
    }

    applyTheme(theme) {
        this.currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        if (this.userId) setPreference('theme', theme);
        this.updateButton();
    }

    toggleTheme() {
        const newTheme = this.currentTheme === THEME_LIGHT ? THEME_DARK : THEME_LIGHT;
        this.applyTheme(newTheme);
    }

    createToggleButton() {
        this.button = document.createElement('button');
        this.button.id = 'themeToggle';
        this.button.className = 'theme-toggle tiny';
        this.button.setAttribute('aria-label', 'Toggle dark mode');
        this.button.setAttribute('title', 'Toggle dark mode');
        this.button.style.marginRight = '12px';

        this.button.addEventListener('click', () => this.toggleTheme());

        const signOutBtn = document.getElementById('signOutBtn');
        if (signOutBtn && signOutBtn.parentElement) {
            signOutBtn.parentElement.insertBefore(this.button, signOutBtn);
        }

        this.updateButton();
    }

    updateButton() {
        if (!this.button) return;

        const isDark = this.currentTheme === THEME_DARK;
        this.button.innerHTML = isDark ? '☀️' : '🌙';
        this.button.setAttribute('aria-pressed', isDark);
        this.button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
        this.button.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    }

    setUserId(userId) {
        this.userId = userId;
        this.applyTheme(this.loadTheme());
    }
}

export const themeManager = new ThemeManager();

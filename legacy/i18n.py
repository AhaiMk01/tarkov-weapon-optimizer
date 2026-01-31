"""
Internationalization (i18n) module for the Tarkov Weapon Optimizer.

Usage:
    from i18n import t, get_language, set_language, LANGUAGES

    # Get translated string
    st.title(t("app.title"))

    # With placeholders
    st.write(t("status.loaded", guns=167, mods=2181))

    # Language selector
    set_language(st.selectbox("Language", LANGUAGES.keys()))
"""

import json
import os
import sys
from functools import lru_cache

import streamlit as st

# Available languages with display names (native)
LANGUAGES = {
    "cs": "Čeština",
    "de": "Deutsch",
    "en": "English",
    "es": "Español",
    "fr": "Français",
    "hu": "Magyar",
    "it": "Italiano",
    "ja": "日本語",
    "ko": "한국어",
    "pl": "Polski",
    "pt": "Português",
    "ro": "Română",
    "ru": "Русский",
    "sk": "Slovenčina",
    "tr": "Türkçe",
    "zh": "中文",
}

DEFAULT_LANGUAGE = "en"

# Handle PyInstaller bundle paths
if getattr(sys, 'frozen', False):
    LOCALES_DIR = os.path.join(sys._MEIPASS, "locales")
else:
    LOCALES_DIR = os.path.join(os.path.dirname(__file__), "locales")


@lru_cache(maxsize=10)
def _load_translations(lang: str) -> dict:
    """Load translations from JSON file. Cached for performance."""
    file_path = os.path.join(LOCALES_DIR, f"{lang}.json")
    if not os.path.exists(file_path):
        # Fallback to English if language file doesn't exist
        file_path = os.path.join(LOCALES_DIR, f"{DEFAULT_LANGUAGE}.json")

    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_language() -> str:
    """Get current language from session state."""
    if "language" not in st.session_state:
        st.session_state.language = DEFAULT_LANGUAGE
    return st.session_state.language


def set_language(lang: str) -> None:
    """Set current language in session state."""
    if lang in LANGUAGES:
        st.session_state.language = lang


def t(key: str, **kwargs) -> str:
    """
    Get translated string by dot-notation key.

    Args:
        key: Dot-notation key like "app.title" or "status.loaded"
        **kwargs: Placeholder values for string formatting

    Returns:
        Translated string, or the key itself if not found

    Examples:
        t("app.title")  # Returns "Tarkov Weapon Mod Optimizer"
        t("status.loaded", guns=167, mods=2181)  # Returns "Loaded 167 guns and 2181 mods"
    """
    lang = get_language()
    translations = _load_translations(lang)

    # Navigate nested dict using dot notation
    value = translations
    for part in key.split("."):
        if isinstance(value, dict) and part in value:
            value = value[part]
        else:
            # Key not found, try English fallback
            if lang != DEFAULT_LANGUAGE:
                fallback = _load_translations(DEFAULT_LANGUAGE)
                for p in key.split("."):
                    if isinstance(fallback, dict) and p in fallback:
                        fallback = fallback[p]
                    else:
                        return key
                if kwargs and isinstance(fallback, str):
                    try:
                        return fallback.format(**kwargs)
                    except KeyError:
                        return fallback
                return fallback
            return key

    # Apply string formatting if placeholders provided
    if kwargs and isinstance(value, str):
        try:
            return value.format(**kwargs)
        except KeyError:
            return value

    return value


def language_selector(
    label: str = "Language",
    key: str = "lang_selector",
    clear_on_change: list = None,
) -> str:
    """
    Render a language selector widget.

    Args:
        label: Label for the selectbox
        key: Streamlit widget key
        clear_on_change: List of session state keys to clear when language changes

    Returns:
        Selected language code
    """
    current = get_language()
    options = list(LANGUAGES.keys())
    current_index = options.index(current) if current in options else 0

    selected = st.selectbox(
        label,
        options=options,
        index=current_index,
        format_func=lambda x: LANGUAGES.get(x, x),
        key=key,
    )

    if selected != current:
        set_language(selected)
        # Clear specified session state keys on language change
        if clear_on_change:
            for state_key in clear_on_change:
                if state_key in st.session_state:
                    del st.session_state[state_key]
        st.rerun()

    return selected

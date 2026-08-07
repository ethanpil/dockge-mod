# Translations

The translation files come from the [Dockge](https://github.com/louislam/dockge) project, which collects them with Weblate. This fork has no Weblate project.

This fork changes only `en.json`, which holds the text of the new features. The other language files keep the text of the upstream project. A key that this fork adds shows its English text until the upstream project has a translation for it.

To add a language to the list in the interface, put the language code and the name at the end of `languageList` in `frontend/src/i18n.ts`, and put the language file in this directory.

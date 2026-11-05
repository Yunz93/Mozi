/**
 * Builds CodeMirror extensions that mirror Obsidian-like editor preference toggles.
 * Used both at editor init and when live-reconfiguring compartments.
 */

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  codeFolding,
  foldGutter,
  foldKeymap,
  indentUnit,
} from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import {
  buildCloseBracketChars,
  buildIndentUnitString,
  normalizeTabSize,
} from "../../../utils/editorPreferences";
import { indentationGuides } from "./indentationGuides";
import {
  createWritingExperience,
  type WritingPreferences,
} from "./writingExperience";

export interface EditorPreferenceOptions extends WritingPreferences {
  autoPairBrackets: boolean;
  autoPairMarkdown: boolean;
  showLineNumbers: boolean;
  enableFolding: boolean;
  tabSize: number;
  useTabs: boolean;
  showIndentationGuides: boolean;
  spellcheck: boolean;
}

export interface EditorPreferenceCompartments {
  closeBrackets: Compartment;
  gutters: Compartment;
  indent: Compartment;
  indentGuides: Compartment;
  spellcheck: Compartment;
  writing: Compartment;
}

export function createEditorPreferenceCompartments(): EditorPreferenceCompartments {
  return {
    closeBrackets: new Compartment(),
    gutters: new Compartment(),
    indent: new Compartment(),
    indentGuides: new Compartment(),
    spellcheck: new Compartment(),
    writing: new Compartment(),
  };
}

export function buildCloseBracketsExtension(
  autoPairBrackets: boolean,
  autoPairMarkdown: boolean,
): Extension {
  const brackets = buildCloseBracketChars(autoPairBrackets, autoPairMarkdown);
  if (brackets.length === 0) return [];

  return [
    closeBrackets(),
    keymap.of(closeBracketsKeymap),
    EditorState.languageData.of(() => [{ closeBrackets: { brackets } }]),
  ];
}

export function buildGutterExtension(
  showLineNumbers: boolean,
  enableFolding: boolean,
): Extension {
  const extensions: Extension[] = [];
  if (showLineNumbers) {
    extensions.push(lineNumbers());
  }
  if (enableFolding) {
    extensions.push(codeFolding(), foldGutter(), keymap.of(foldKeymap));
  }
  return extensions;
}

export function buildIndentExtension(
  tabSize: number,
  useTabs: boolean,
): Extension {
  const normalizedTabSize = normalizeTabSize(tabSize);
  const unit = buildIndentUnitString(normalizedTabSize, useTabs);
  return [EditorState.tabSize.of(normalizedTabSize), indentUnit.of(unit)];
}

export function buildIndentGuidesExtension(enabled: boolean): Extension {
  return enabled ? indentationGuides() : [];
}

export function buildSpellcheckExtension(enabled: boolean): Extension {
  return EditorView.contentAttributes.of({
    spellcheck: enabled ? "true" : "false",
  });
}

export function buildEditorPreferenceEffects(
  compartments: EditorPreferenceCompartments,
  options: EditorPreferenceOptions,
) {
  return [
    compartments.writing.reconfigure(createWritingExperience(options)),
    compartments.closeBrackets.reconfigure(
      buildCloseBracketsExtension(
        options.autoPairBrackets,
        options.autoPairMarkdown,
      ),
    ),
    compartments.gutters.reconfigure(
      buildGutterExtension(options.showLineNumbers, options.enableFolding),
    ),
    compartments.indent.reconfigure(
      buildIndentExtension(options.tabSize, options.useTabs),
    ),
    compartments.indentGuides.reconfigure(
      buildIndentGuidesExtension(options.showIndentationGuides),
    ),
    compartments.spellcheck.reconfigure(
      buildSpellcheckExtension(options.spellcheck),
    ),
  ];
}

export function wrapEditorPreferenceExtensions(
  compartments: EditorPreferenceCompartments,
  options: EditorPreferenceOptions,
): Extension[] {
  return [
    compartments.writing.of(createWritingExperience(options)),
    compartments.closeBrackets.of(
      buildCloseBracketsExtension(
        options.autoPairBrackets,
        options.autoPairMarkdown,
      ),
    ),
    compartments.gutters.of(
      buildGutterExtension(options.showLineNumbers, options.enableFolding),
    ),
    compartments.indent.of(
      buildIndentExtension(options.tabSize, options.useTabs),
    ),
    compartments.indentGuides.of(
      buildIndentGuidesExtension(options.showIndentationGuides),
    ),
    compartments.spellcheck.of(buildSpellcheckExtension(options.spellcheck)),
  ];
}

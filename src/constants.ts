export const EXT_ID = 'grainpool.wysee-md';
export const VIEWTYPE_EDITOR = 'grainpool.wysee-md.editor';

export const MARKDOWN_PATTERNS = ['*.md', '*.markdown', '*.mdown', '*.mkdn', '*.mkd'];

export const CTX = {
  editorActive: 'wyseeMd.editorActive',
  markdownSourceActive: 'wyseeMd.markdownSourceActive',
  editorEditable: 'wyseeMd.editorEditable',
  canInsertBlock: 'wyseeMd.canInsertBlock',
  editPanelActive: 'wyseeMd.editPanelActive',
  spellMisspelled: 'wyseeMd.spellMisspelled',
  blockKind: 'wyseeMd.blockKind',
  hasSelection: 'wyseeMd.hasSelection',
  browserPrintAvailable: 'wyseeMd.browserPrintAvailable',
} as const;

export const STORAGE = {
  activeThemeId: 'wyseeMd.activeThemeId',
  activePageProfileId: 'wyseeMd.activePageProfileId',
  themeLibraryIndex: 'wyseeMd.themeLibraryIndex',
  userDictionaryIndex: 'wyseeMd.userDictionaryIndex',
  defaultAssociationApplied: 'wyseeMd.defaultAssociationApplied',
  associationPatternsAdded: 'wyseeMd.associationPatternsAdded',
} as const;

export const ERR_PREFIX = 'WMD';

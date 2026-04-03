// Copyright 2025-2026 Grainpool Holdings LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as assert from 'assert';
import { compileThemeToPreviewCss, compileThemeToPrintCss } from '../src/theme/styleCompiler';

const theme: any = {
  id: 'default',
  name: 'Default',
  selectorStyles: { body: 'font-family: serif', h1: 'font-size: 2rem', img: 'max-width: 100%' },
};
const page: any = {
  id: 'letter-default',
  name: 'Letter',
  format: 'Letter',
  landscape: false,
  marginTop: '1in',
  marginRight: '1in',
  marginBottom: '1in',
  marginLeft: '1in',
  codeBlocks: { wrap: true },
  images: { defaultAlign: 'center', maxWidth: '100%' },
  columns: { enabled: false, count: 1, gap: '1rem' },
};

describe('theme and page profile compilation', () => {
  it('compiles preview css', () => {
    const css = compileThemeToPreviewCss(theme);
    assert.ok(css.includes('.wysee-block h1'));
    assert.ok(css.includes('font-size: 2rem'));
  });

  it('compiles print css with page rules', () => {
    const css = compileThemeToPrintCss(theme, page);
    assert.ok(css.includes('@page'));
    assert.ok(css.includes('margin: 1in 1in 1in 1in'));
  });
});

import { describe, it, expect } from 'vitest'
import {
  baseName,
  isNotePath,
  isSameOrUnder,
  joinPath,
  noteStem,
  parentOf,
  remapPath,
  renameTarget,
  validateName,
} from './paths'

describe('vault paths', () => {
  it('splits and joins vault-relative paths', () => {
    expect(parentOf('A/B/c.md')).toBe('A/B')
    expect(parentOf('c.md')).toBe('')
    expect(baseName('A/B/c.md')).toBe('c.md')
    expect(joinPath('', 'c.md')).toBe('c.md')
    expect(joinPath('A', 'c.md')).toBe('A/c.md')
  })

  it('names notes without their extension', () => {
    expect(isNotePath('a.MD')).toBe(true)
    expect(isNotePath('a.png')).toBe(false)
    expect(noteStem('Projects/Plan.md')).toBe('Plan')
    expect(noteStem('image.png')).toBe('image.png')
  })

  it('remaps paths at or under a renamed entry only', () => {
    expect(isSameOrUnder('A/b.md', 'A')).toBe(true)
    expect(isSameOrUnder('AB/b.md', 'A')).toBe(false)
    expect(remapPath('A/b.md', 'A', 'Z')).toBe('Z/b.md')
    expect(remapPath('A', 'A', 'Z')).toBe('Z')
    expect(remapPath('AB/b.md', 'A', 'Z')).toBe('AB/b.md')
  })

  it.each([
    ['', 'vault.names.empty'],
    ['   ', 'vault.names.empty'],
    ['..', 'vault.names.dot'],
    ['.hidden', 'vault.names.dot'],
    ['a/b', 'vault.names.invalidChars'],
    ['a:b', 'vault.names.invalidChars'],
    ['Fine name', null],
  ])('validates %j', (name, expected) => {
    expect(validateName(name)).toBe(expected)
  })

  it('keeps .md on renamed notes but not on folders', () => {
    expect(renameTarget('A/old.md', 'New', 'note')).toBe('A/New.md')
    expect(renameTarget('A/old.md', 'New.md', 'note')).toBe('A/New.md')
    expect(renameTarget('A/Old', 'New', 'folder')).toBe('A/New')
  })
})

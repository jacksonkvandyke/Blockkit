import assert from 'node:assert/strict'
import { test } from 'node:test'
import { maskCSharp, parseCSharpTestSource } from '../src/lib/test-parser-cs.js'

const names = (src) => parseCSharpTestSource(src).tests.map((t) => t.name)
const claims = (src) => parseCSharpTestSource(src).tests.map((t) => t.claim)
const statuses = (src) => parseCSharpTestSource(src).tests.map((t) => t.status)

test('reads the claim from an xUnit DisplayName', () => {
  const src = `
    public class LauncherTests
    {
        [Fact(DisplayName = "C1: reports nothing when the launcher is absent")]
        public void ReportsNothing() { }
    }`
  assert.deepEqual(names(src), ['C1: reports nothing when the launcher is absent'])
  assert.deepEqual(claims(src), ['C1'])
})

test('falls back to the method name when there is no DisplayName', () => {
  const src = `
    [Fact]
    public void C2_Reports_one_entry_per_folder() { }`
  assert.deepEqual(names(src), ['C2_Reports_one_entry_per_folder'])
  assert.deepEqual(claims(src), ['C2'])
})

test('recognises Theory, NUnit Test and TestCase', () => {
  const src = `
    [Theory(DisplayName = "C1: a")]
    public void A(int x) { }

    [Test]
    public void C2_b() { }

    [TestCase(3)]
    public void C3_c(int n) { }`
  assert.deepEqual(claims(src), ['C1', 'C2', 'C3'])
})

test('an async Task test is read like any other', () => {
  const src = `
    [Fact(DisplayName = "C4: moves the game")]
    public async Task MovesTheGame() { await Task.Yield(); }`
  assert.deepEqual(claims(src), ['C4'])
})

test('a generic test method still yields its name', () => {
  const src = `
    [Fact]
    public void C5_handles<TSource>() { }`
  assert.deepEqual(claims(src), ['C5'])
})

test('Skip marks a test skipped, and Ignore does too', () => {
  const src = `
    [Fact(DisplayName = "C1: a", Skip = "flaky on CI")]
    public void A() { }

    [Test, Ignore("not yet")]
    public void C2_b() { }

    [Fact(DisplayName = "C3: c")]
    public void C() { }`
  assert.deepEqual(statuses(src), ['skipped', 'skipped', 'active'])
})

test('other attributes stacked on the method are stepped over', () => {
  const src = `
    [Fact(DisplayName = "C6: still found")]
    [Trait("Category", "Pipeline")]
    [SuppressMessage("x", "y")]
    public void StillFound() { }`
  assert.deepEqual(claims(src), ['C6'])
})

test('a fully qualified attribute is recognised', () => {
  const src = `
    [Xunit.Fact(DisplayName = "C7: qualified")]
    public void Qualified() { }`
  assert.deepEqual(claims(src), ['C7'])
})

test('a commented-out test does not count', () => {
  const src = `
    // [Fact(DisplayName = "C1: gone")]
    // public void Gone() { }

    /* [Fact(DisplayName = "C2: also gone")]
       public void AlsoGone() { } */

    [Fact(DisplayName = "C3: here")]
    public void Here() { }`
  assert.deepEqual(claims(src), ['C3'])
})

test('an attribute written inside a string does not count', () => {
  const src = `
    [Fact(DisplayName = "C1: real")]
    public void Real()
    {
        var sample = "[Fact(DisplayName = \\"C2: fake\\")] public void Fake() { }";
        var verbatim = @"[Theory] public void AlsoFake() { }";
    }`
  assert.deepEqual(claims(src), ['C1'])
})

test('a verbatim string ending in a backslash does not swallow the file', () => {
  const src = `
    [Fact(DisplayName = "C1: first")]
    public void First() { var p = @"C:\\"; }

    [Fact(DisplayName = "C2: second")]
    public void Second() { }`
  assert.deepEqual(claims(src), ['C1', 'C2'])
})

test('a doubled quote inside a verbatim string is an escaped quote', () => {
  const src = `
    [Fact(DisplayName = "C1: first")]
    public void First() { var p = @"say ""hi"" now"; }

    [Fact(DisplayName = "C2: second")]
    public void Second() { }`
  assert.deepEqual(claims(src), ['C1', 'C2'])
})

test('a DisplayName holding an escape reads as text', () => {
  const src = `
    [Fact(DisplayName = "C1: quotes \\"like this\\"")]
    public void A() { }`
  assert.deepEqual(names(src), ['C1: quotes "like this"'])
})

test('a test that names no claim is reported rather than dropped', () => {
  const src = `
    [Fact]
    public void JustAHelperTest() { }`
  assert.deepEqual(names(src), ['JustAHelperTest'])
  assert.deepEqual(claims(src), [null])
})

test('line numbers point at the attribute', () => {
  const src = ['class T {', '', '  [Fact(DisplayName = "C1: a")]', '  public void A() { }', '}'].join('\n')
  assert.equal(parseCSharpTestSource(src).tests[0].line, 3)
})

test('maskCSharp keeps the file length and its line breaks', () => {
  const src = 'var a = "one";\n// two\nvar b = 3;\n'
  const masked = maskCSharp(src)
  assert.equal(masked.length, src.length)
  assert.equal(masked.split('\n').length, src.split('\n').length)
  assert.equal(masked.includes('one'), false)
  assert.equal(masked.includes('two'), false)
})

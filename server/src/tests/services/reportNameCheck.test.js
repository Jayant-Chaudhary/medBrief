const {
  reportNameDiffers,
  reportNameProblem,
  NAME_MISMATCH,
  NAME_UNREADABLE,
} = require('../../services/reportNameCheck.service');

describe('reportNameProblem', () => {
  it.each([
    ['a matching name', 'Mrs. Asha Example', null],
    ['a different name', 'Someone Else', NAME_MISMATCH],
    ['no name', undefined, NAME_UNREADABLE],
    ['an empty name', '   ', NAME_UNREADABLE],
    ['only a title', 'Mrs.', NAME_UNREADABLE],
  ])('for %s on the report', (_label, onReport, expected) => {
    expect(reportNameProblem(onReport, 'Asha Example')).toBe(expected);
  });

  it('has nothing to say when the account has no name to compare against', () => {
    expect(reportNameProblem(undefined, null)).toBeNull();
    expect(reportNameProblem('Someone Else', '')).toBeNull();
  });
});

describe('reportNameDiffers', () => {
  it.each([
    ['the same name', 'Asha Example', 'Asha Example'],
    ['different case', 'ASHA EXAMPLE', 'Asha Example'],
    ['a title', 'Mrs. Asha Example', 'Asha Example'],
    ['a combined title', 'Mr/Mrs Asha Example', 'Asha Example'],
    ['reversed order', 'Example, Asha', 'Asha Example'],
    ['a middle name on the report', 'Asha Rani Example', 'Asha Example'],
    ['a middle name on the account', 'Asha Example', 'Asha Rani Example'],
    ['first name only', 'Asha', 'Asha Example'],
    ['an initial', 'A. Example', 'Asha Example'],
    ['eaten spaces', 'ASHAEXAMPLE', 'Asha Example'],
    ['age and sex printed after the name', 'Asha Example 27 Y F', 'Asha Example'],
    ['accents', 'Ásha Example', 'Asha Example'],
    ['a misread letter in a long word', 'Asha Exampie', 'Asha Example'],
    ['the same name in another script', 'आशा', 'आशा'],
  ])('accepts %s', (_label, onReport, onAccount) => {
    expect(reportNameDiffers(onReport, onAccount)).toBe(false);
  });

  it.each([
    ['a different person', 'Someone Else', 'Asha Example'],
    ['a relative with the same family name', 'Bina Example', 'Asha Example'],
    ['the same first name in another family', 'Asha Sample', 'Asha Example'],
    ['short names one letter apart', 'Riya Example', 'Priya Example'],
    ['a wrong initial', 'B. Example', 'Asha Example'],
    ['names in different scripts', 'आशा', 'Asha Example'],
  ])('flags %s', (_label, onReport, onAccount) => {
    expect(reportNameDiffers(onReport, onAccount)).toBe(true);
  });

  it.each([
    ['no name on the report', undefined, 'Asha Example'],
    ['an empty name on the report', '   ', 'Asha Example'],
    ['only a title on the report', 'Mrs.', 'Asha Example'],
    ['digits on the report', '12345', 'Asha Example'],
    ['no name on the account', 'Asha Example', null],
  ])('does not flag %s', (_label, onReport, onAccount) => {
    expect(reportNameDiffers(onReport, onAccount)).toBe(false);
  });
});

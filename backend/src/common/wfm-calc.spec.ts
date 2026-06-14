import {
  isWeekend, shiftCoversHour, shiftCoversWindow, shiftCategory,
  shrinkagePct, mapLeaveMarker, mimeToAttachmentType, ratingSentiment,
} from './wfm-calc';

describe('isWeekend (Boutiqaat Thu/Fri/Sat)', () => {
  it('flags Thursday(4), Friday(5) and Saturday(6)', () => {
    expect(isWeekend(4)).toBe(true);
    expect(isWeekend(5)).toBe(true);
    expect(isWeekend(6)).toBe(true);
  });
  it('rejects Sun–Wed', () => {
    [0, 1, 2, 3].forEach(d => expect(isWeekend(d)).toBe(false));
  });
});

describe('shiftCoversHour', () => {
  it('normal shift 09–18 covers 13, not 8 or 18', () => {
    expect(shiftCoversHour(9, 18, 13)).toBe(true);
    expect(shiftCoversHour(9, 18, 8)).toBe(false);
    expect(shiftCoversHour(9, 18, 18)).toBe(false); // end exclusive
  });
  it('cross-midnight shift 22–07 covers 23 and 03, not 12', () => {
    expect(shiftCoversHour(22, 7, 23)).toBe(true);
    expect(shiftCoversHour(22, 7, 3)).toBe(true);
    expect(shiftCoversHour(22, 7, 12)).toBe(false);
  });
});

describe('shiftCoversWindow', () => {
  it('09–18 covers gap 14–15 but not 17–19', () => {
    expect(shiftCoversWindow(9, 18, 14, 15)).toBe(true);
    expect(shiftCoversWindow(9, 18, 17, 19)).toBe(false);
  });
  it('cross-midnight 22–07 covers gap 02–03', () => {
    expect(shiftCoversWindow(22, 7, 2, 3)).toBe(true);
  });
});

describe('shiftCategory', () => {
  it('buckets by start hour', () => {
    expect(shiftCategory(7)).toBe('morning');
    expect(shiftCategory(13)).toBe('evening');
    expect(shiftCategory(19)).toBe('night');
    expect(shiftCategory(23)).toBe('midnight');
    expect(shiftCategory(2)).toBe('midnight');
  });
});

describe('shrinkagePct', () => {
  it('computes % to 1 dp and guards divide-by-zero', () => {
    expect(shrinkagePct(100, 15)).toBe(15);
    expect(shrinkagePct(0, 5)).toBe(0);
    expect(shrinkagePct(3, 1)).toBe(33.3);
  });
});

describe('mapLeaveMarker', () => {
  it('maps sick/holiday/other', () => {
    expect(mapLeaveMarker('Sick Leave')).toBe('sick');
    expect(mapLeaveMarker('إجازة مرضية')).toBe('sick');
    expect(mapLeaveMarker('Public Holiday')).toBe('holiday');
    expect(mapLeaveMarker('Annual Leave')).toBe('leave');
    expect(mapLeaveMarker('')).toBe('leave');
  });
});

describe('mimeToAttachmentType', () => {
  it('maps mime families', () => {
    expect(mimeToAttachmentType('image/png')).toBe('image');
    expect(mimeToAttachmentType('video/mp4')).toBe('video');
    expect(mimeToAttachmentType('audio/webm')).toBe('audio');
    expect(mimeToAttachmentType('application/pdf')).toBe('file');
  });
});

describe('ratingSentiment', () => {
  it('CSAT 1-5 scale', () => {
    expect(ratingSentiment('5')).toBe('positive');
    expect(ratingSentiment('4')).toBe('positive');
    expect(ratingSentiment('3')).toBe('neutral');
    expect(ratingSentiment('1')).toBe('negative');
  });
  it('NPS 0-10 scale', () => {
    expect(ratingSentiment('9')).toBe('positive');
    expect(ratingSentiment('7')).toBe('neutral');
    expect(ratingSentiment('6')).toBe('negative');
  });
  it('words + empty', () => {
    expect(ratingSentiment('Excellent')).toBe('positive');
    expect(ratingSentiment('bad')).toBe('negative');
    expect(ratingSentiment('')).toBeNull();
    expect(ratingSentiment(null)).toBeNull();
  });
});

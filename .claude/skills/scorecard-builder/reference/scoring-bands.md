# Scoring bands — provenance

Decoded from the IF-formulas inside the user's real template `<Month> SC 26` sheet
(`My work/OPS/Score Card 2026/4.April 26 SC..xlsx`, `5.May 26 SC..xlsx`). The 2026 files
hold the FINAL criteria; older (2025) files only show the method.

Round every percentage **round-half-up to an integer** before banding: `Math.round(v*100)`.

```js
const rP = v => (v===''||v==null||isNaN(v)) ? null : Math.round(Number(v)*100); // round-half-up percent

// Quality / QA
sQ  = p => p>=95?30 : p>=90?20 : p>=80?10 : p>=65?-10 : -20;
// PRR — two cells, each 2.5 when both gates pass
sP  = (prr,res) => (rP(prr)>=80 && rP(res)>=10) ? 2.5 : 0;   // PRR Points and PRR Bonus each
// AHT — single 48h threshold (keep until Sprinklr revision); a = day-fraction
sA  = a => (Number(a)*24 <= 48) ? 10 : -10;
// FCR
sF  = p => p>=85?20 : p>=80?10 : p>=75?5 : -10;
// Productivity (note discrete 90 / 89 steps)
sPr = p => p>=91?15 : p===90?10 : p===89?5 : p<=86?-15 : 0;   // 87–88 → 0
// CTR
sC  = p => p>=95?10 : (p>=90&&p<=94)?5 : -10;
// Quiz (input is FRACTION pts/100, so round-half-up the fraction*100)
sQz = p => (p>95&&p<=100)?10 : (p>=90&&p<=95)?5 : p<90?-10 : '';
// Common Mistakes (count n)
sM  = n => 15 - n*5;
// Response Time (FRT day-fraction)
sRt = rt => rt<=1/24?15 : rt<=2/24?10 : rt<=4/24?5 : -15;
```

**Bars (max-score thresholds, "العتبة"):** QA 0.80 · FCR 0.80 · CTR 0.90 · Sprinklr CTR override 1.0.

**Net Points** = sum of: QualityScore, PRR Points, PRR Bonus, AHTScore, FCRScore, ProdScore,
CTRScore, QuizScore, MistakesScore, ResponseTimeScore (+ CommitmentScore when used). Max ≈ 130.

**Template main-sheet columns (header row 12, cols B→AG):** Agent, ID, User ID, Function, TL,
Working Days%, **Net Points**, Weeks, Quality, QualityScore, ResponseRate, PRRrate, PRRPoints,
PRRBonus, AHT, AHTScore, Suc%-FCR, FCRScore, Product., ProductScore, CallToTicketRatio, CTRScore,
Quiz, QuizScore, CommonMistakes, MistakesScore, Incidents, IncidentScore, AttendanceCommitment,
AttendanceScore, (blank), ResponseTimeScore. Rows 0–10 hold the rubric.

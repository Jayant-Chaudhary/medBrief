# Prescription factor catalogue

Research and repository mapping reviewed on 30 October 2026. This is a proposed starter data catalogue for the clinician to review, not a validated prescribing model or a mandatory set of investigations. Relevance depends on the patient, indication, medicine, local protocol and stage of pregnancy. No diagnostic cutoffs, vaccination schedule or treatment recommendations are implemented.

The Prescription section contains Factors. Edit / add factors opens patient values, grouped fields, search and the editable factor list. New custom fields immediately appear for entry in this visit and future visits for this clinician. Values remain separate by clinician, patient and encounter.

## Source-backed starter list

The clinical references support collecting relevant information; the division into software fields and matching logic is our implementation choice. Screening results are recorded as results, not confirmed infection diagnoses. Glucose and HbA1c do not automatically diagnose gestational diabetes. Thyroid, renal and liver tests are context-dependent rather than routine requirements for everyone.

### Prescription checks

| Factor | Type / unit | Current app mapping | Clinical reference |
|---|---|---|---|
| Age | number / years | Patient field: age; otherwise doctor entry | [NICE NG201: antenatal assessment](https://www.nice.org.uk/guidance/ng201/chapter/recommendations) |
| Consultation purpose / indication | text | Visit field: purpose; otherwise doctor entry | [NICE NG5: medicines and allergy reconciliation](https://www.nice.org.uk/guidance/ng5/chapter/Recommendations) |
| Drug allergy status | select | Doctor entry; no automatic report mapping | [NICE NG5: medicines and allergy reconciliation](https://www.nice.org.uk/guidance/ng5/chapter/Recommendations) |
| Allergy and reaction details | text | Doctor entry; no automatic report mapping | [NICE NG5: medicines and allergy reconciliation](https://www.nice.org.uk/guidance/ng5/chapter/Recommendations) |
| Current medicines, supplements and recent injections | text | Doctor entry; no automatic report mapping | [NICE NG5: medicines and allergy reconciliation](https://www.nice.org.uk/guidance/ng5/chapter/Recommendations) |
| Confirmed diabetes status | select | Doctor entry; no automatic report mapping | [NICE NG3: diabetes in pregnancy](https://www.nice.org.uk/guidance/ng3/chapter/Recommendations) |
| Confirmed hypertension status | select | Doctor entry; no automatic report mapping | [NICE NG133: hypertension in pregnancy](https://www.nice.org.uk/guidance/ng133/chapter/recommendations) |
| Confirmed thyroid disease | select | Doctor entry; no automatic report mapping | [RCOG: thyroid disorders in pregnancy](https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/management-of-thyroid-disorders-in-pregnancy-no-76/) |
| Known kidney disease | select | Doctor entry; no automatic report mapping | [NICE NG133: hypertension in pregnancy](https://www.nice.org.uk/guidance/ng133/chapter/recommendations) |
| Known liver disease | select | Doctor entry; no automatic report mapping | [NICE NG133: hypertension in pregnancy](https://www.nice.org.uk/guidance/ng133/chapter/recommendations) |

### Pregnancy & history

| Factor | Type / unit | Current app mapping | Clinical reference |
|---|---|---|---|
| Pregnancy / postnatal stage | select | Patient field: pregnancyStage; otherwise doctor entry | [NICE NG201: antenatal assessment](https://www.nice.org.uk/guidance/ng201/chapter/recommendations) |
| Gestational age | number / weeks | Doctor entry; no automatic report mapping | [NICE NG201: antenatal assessment](https://www.nice.org.uk/guidance/ng201/chapter/recommendations) |
| Breastfeeding | select | Doctor entry; no automatic report mapping | [NICE NG5: medicines and allergy reconciliation](https://www.nice.org.uk/guidance/ng5/chapter/Recommendations) |
| Weight | number / kg | Shared report key: weight | [NICE NG201: antenatal assessment](https://www.nice.org.uk/guidance/ng201/chapter/recommendations) |
| Height | number / cm | Shared report key: height | [NICE NG201: antenatal assessment](https://www.nice.org.uk/guidance/ng201/chapter/recommendations) |
| Booking BMI | number / kg/m2 | Doctor entry; no automatic report mapping | [NICE NG201: antenatal assessment](https://www.nice.org.uk/guidance/ng201/chapter/recommendations) |
| Blood group and RhD status | select | Patient field: bloodType; otherwise doctor entry | [NICE NG201: antenatal assessment](https://www.nice.org.uk/guidance/ng201/chapter/recommendations) |
| Red-cell antibody screen | select | Doctor entry; no automatic report mapping | [NICE NG201: antenatal assessment](https://www.nice.org.uk/guidance/ng201/chapter/recommendations) |
| Previous pregnancy outcomes / complications | text | Doctor entry; no automatic report mapping | [NICE NG201: antenatal assessment](https://www.nice.org.uk/guidance/ng201/chapter/recommendations) |
| Previous gestational diabetes | select | Doctor entry; no automatic report mapping | [NICE NG3: diabetes in pregnancy](https://www.nice.org.uk/guidance/ng3/chapter/Recommendations) |
| Previous pre-eclampsia | select | Doctor entry; no automatic report mapping | [NICE NG133: hypertension in pregnancy](https://www.nice.org.uk/guidance/ng133/chapter/recommendations) |
| First-degree family history of diabetes | select | Doctor entry; no automatic report mapping | [NICE NG3: diabetes in pregnancy](https://www.nice.org.uk/guidance/ng3/chapter/Recommendations) |
| Current tobacco use / exposure | text | Doctor entry; no automatic report mapping | [NICE NG201: antenatal assessment](https://www.nice.org.uk/guidance/ng201/chapter/recommendations) |
| Alcohol / other substance use | text | Doctor entry; no automatic report mapping | [NICE NG201: antenatal assessment](https://www.nice.org.uk/guidance/ng201/chapter/recommendations) |

### Report measurements

| Factor | Type / unit | Current app mapping | Clinical reference |
|---|---|---|---|
| Haemoglobin | number / g/dL | Shared report key: hemoglobin | [NICE NG201: antenatal assessment](https://www.nice.org.uk/guidance/ng201/chapter/recommendations) |
| Platelet count | number / 10^3/µL | Shared report key: platelets | [NICE NG133: hypertension in pregnancy](https://www.nice.org.uk/guidance/ng133/chapter/recommendations) |
| Systolic blood pressure | number / mmHg | Shared report key: blood_pressure_systolic | [NICE NG133: hypertension in pregnancy](https://www.nice.org.uk/guidance/ng133/chapter/recommendations) |
| Diastolic blood pressure | number / mmHg | Shared report key: blood_pressure_diastolic | [NICE NG133: hypertension in pregnancy](https://www.nice.org.uk/guidance/ng133/chapter/recommendations) |
| Fasting blood glucose | number / mg/dL | Shared report key: blood_glucose_fasting | [NICE NG3: diabetes in pregnancy](https://www.nice.org.uk/guidance/ng3/chapter/Recommendations) |
| Post-meal blood glucose | number / mg/dL | Shared report key: blood_glucose_pp | [NICE NG3: diabetes in pregnancy](https://www.nice.org.uk/guidance/ng3/chapter/Recommendations) |
| Random blood glucose | number / mg/dL | Shared report key: blood_glucose_random | [NICE NG3: diabetes in pregnancy](https://www.nice.org.uk/guidance/ng3/chapter/Recommendations) |
| HbA1c | number / % | Shared report key: hba1c | [NICE NG3: diabetes in pregnancy](https://www.nice.org.uk/guidance/ng3/chapter/Recommendations) |
| OGTT protocol, time points, values and units | text | Doctor entry; no automatic report mapping | [NICE NG3: diabetes in pregnancy](https://www.nice.org.uk/guidance/ng3/chapter/Recommendations) |
| TSH | number / µIU/mL | Shared report key: tsh | [RCOG: thyroid disorders in pregnancy](https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/management-of-thyroid-disorders-in-pregnancy-no-76/) |
| Free T4 | number / ng/dL | Shared report key: t4_free | [RCOG: thyroid disorders in pregnancy](https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/management-of-thyroid-disorders-in-pregnancy-no-76/) |
| Serum creatinine | number / mg/dL | Shared report key: creatinine | [NICE NG133: hypertension in pregnancy](https://www.nice.org.uk/guidance/ng133/chapter/recommendations) |
| ALT | number / U/L | Shared report key: alt | [NICE NG133: hypertension in pregnancy](https://www.nice.org.uk/guidance/ng133/chapter/recommendations) |
| AST | number / U/L | Shared report key: ast | [NICE NG133: hypertension in pregnancy](https://www.nice.org.uk/guidance/ng133/chapter/recommendations) |
| Urine protein | text | Shared report key: urine_protein | [NICE NG133: hypertension in pregnancy](https://www.nice.org.uk/guidance/ng133/chapter/recommendations) |
| Urine culture / susceptibility result | text | Doctor entry; no automatic report mapping | [NICE NG201: antenatal assessment](https://www.nice.org.uk/guidance/ng201/chapter/recommendations) |

### Infection & prevention

| Factor | Type / unit | Current app mapping | Clinical reference |
|---|---|---|---|
| HIV screening result | select | Doctor entry; no automatic report mapping | [WHO: HIV, syphilis and hepatitis B in pregnancy](https://www.who.int/teams/global-hiv-hepatitis-and-stis-programmes/populations/pregnant-and-lactating-women-and-girls) |
| Hepatitis B surface antigen result | select | Doctor entry; no automatic report mapping | [WHO: HIV, syphilis and hepatitis B in pregnancy](https://www.who.int/teams/global-hiv-hepatitis-and-stis-programmes/populations/pregnant-and-lactating-women-and-girls) |
| Syphilis screening test and result | text | Doctor entry; no automatic report mapping | [WHO: HIV, syphilis and hepatitis B in pregnancy](https://www.who.int/teams/global-hiv-hepatitis-and-stis-programmes/populations/pregnant-and-lactating-women-and-girls) |
| Vaccines / injections already received and dates | text | Doctor entry; no automatic report mapping | [CDC: vaccination records in pregnancy](https://www.cdc.gov/vaccines-pregnancy/recommended-vaccines/) |
| Previous vaccine reaction | text | Doctor entry; no automatic report mapping | [CDC: vaccination records in pregnancy](https://www.cdc.gov/vaccines-pregnancy/recommended-vaccines/) |

## What is actually available

The metric dictionary already supports the mapped haemoglobin, platelet, glucose, thyroid, creatinine, ALT/AST, blood pressure, weight, height and urine-protein keys. This means the extractor can represent those metrics; it does not guarantee that a particular patient has them. The view adapter reads the reports already shared with this clinician, chooses the latest dated result per field, and displays its source and date. Shared reports reuse the dashboard data. Saved maternity values now load through the existing get-card endpoint. The saved maternity-card endpoint is now connected; dedicated vitals endpoints are still not fetched separately. Booking BMI, gestational dating, antibody results, OGTT protocol, infection screens and history remain manual unless explicitly connected later.

## Data quality and customisation

OCR-flagged values are excluded from matching until reviewed. Unexpected units require a verified value in the expected unit. Bound results such as <0.5 stay as printed and cannot silently become exact numeric readings. Source dates remain visible; no universal freshness window is imposed. A normal report does not clear a diagnosis or an allergy. Unknown is distinct from No or a negative test.

Custom definitions have stable IDs, a label, answer type, unit, choices and enabled status. Existing field types and units are fixed to avoid reinterpreting saved values. Definitions can be renamed or hidden. Doctor entries override refreshed report values; Use record value restores the source. Definitions and values are local browser records, not a Supabase connection.

## Connection to matching

Template setup offers Add factor rule with equals, minimum or maximum comparisons as appropriate. The clinician supplies comparison values; none are invented from the guidelines. Custom fields use the same controls. Missing, disabled, uncertain or incompatible-unit values stay unknown. Known rule conflicts block applying. Identical duplicate rules count once. The percentage remains an equal-weight criteria match, not treatment safety or a trained statistical model.


## Maternity-card extension (83 total fields)

The following 38 fields extend the original catalogue. Their source is the [existing maternity controller](../../../../server/src/controllers/maternity.controller.js), rather than new clinical recommendations. Existing factors also reuse card blood group, haemoglobin, TSH, weight, blood pressure, gestational weeks and vaccine history.

| Field | Type / unit | Group |
|---|---|---|
| First antenatal attendance | date | Maternity card |
| Last menstrual period (LMP) | date | Maternity card |
| Expected date of delivery (EDD) | date | Maternity card |
| Gravida | number | Maternity card |
| Para | number | Maternity card |
| Living children | number | Maternity card |
| Abortions / pregnancy losses | number | Maternity card |
| Relevant history / allergies recorded on card | text | Maternity card |
| Chest history / examination | text | Maternity card |
| Cardiovascular history / examination | text | Maternity card |
| Baseline investigation date | date | Maternity card |
| Other baseline investigation results | text | Maternity card |
| Additional gestational days | number / days | Maternity card |
| Latest antenatal visit date | date | Maternity card |
| Fundal height | number / cm | Maternity card |
| Fetal presentation | select | Maternity card |
| Relation of presentation to brim | text | Maternity card |
| Fetal heart rate | number / bpm | Maternity card |
| Urine albumin on maternity card | select | Maternity card |
| Urine sugar on maternity card | select | Maternity card |
| Next antenatal visit | date | Maternity card |
| Antenatal advice / notes | text | Maternity card |
| Repeat investigations: dates, tests and results | text | Maternity card |
| Latest ultrasound date | date | Scans & vaccinations |
| Gestational weeks at latest ultrasound | number / weeks | Scans & vaccinations |
| Additional days at latest ultrasound | number / days | Scans & vaccinations |
| Latest ultrasound report / findings | text | Scans & vaccinations |
| Ultrasound history | text | Scans & vaccinations |
| Recorded next vaccine / injection date | date | Scans & vaccinations |
| Type of delivery | select | Delivery & postnatal |
| Delivery date and time | datetime-local | Delivery & postnatal |
| Delivery indication | text | Delivery & postnatal |
| Sex of baby | select | Delivery & postnatal |
| Baby birth weight | number / kg | Delivery & postnatal |
| APGAR at 1 minute | number | Delivery & postnatal |
| APGAR at 5 minutes | number | Delivery & postnatal |
| Next postnatal visit | date | Delivery & postnatal |
| Postnatal advice | text | Delivery & postnatal |

Patient names, IDs and contact details remain in the patient header rather than becoming matching factors. The clinician signature is retained as source metadata on antenatal observations. Newborn fields are visible but are not automatically included in maternal similarity snapshots. Delivery fields require an actual delivery date; no birth is inferred from a default delivery-type selection. Gestational weeks/days remain the recorded observation, not a newly calculated current gestation.

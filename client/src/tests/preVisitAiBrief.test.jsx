import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreVisitAiBriefCard } from '../components/clinician/PreVisitAiBriefCard.jsx';

describe('PreVisitAiBriefCard Component', () => {
  const mockUrgentSummary = {
    id: 'summary-1',
    appointment_id: 'appt-1',
    clinical_risk_level: 'urgent',
    red_flags: ['Persistent severe headache reported', 'Decreased fetal kicks in past 24h'],
    mental_health_assessment: 'Elevated anxiety regarding labor; restless sleep reported.',
    physical_symptom_trajectory: 'Bilateral ankle swelling began at week 26 and has escalated.',
    medication_compliance: '100% adherence to daily prenatal iron and vitamins.',
    patient_top_questions: ['Is sudden swelling in my feet dangerous at week 28?'],
    doctor_talking_points: 'Check urine protein dipstick and re-evaluate BP.',
    generated_at: '2026-11-02T10:00:00Z',
    interval_description: '14 days since last visit (2026-10-19)',
  };

  const mockRoutineSummary = {
    id: 'summary-2',
    appointment_id: 'appt-2',
    clinical_risk_level: 'low',
    red_flags: [],
    mental_health_assessment: 'Stable mood and calm emotional state.',
    physical_symptom_trajectory: 'Healthy fetal movements felt daily. Mild typical fatigue.',
    medication_compliance: 'Vitamins taken daily.',
    patient_top_questions: [],
    doctor_talking_points: 'Routine third trimester antenatal review.',
    generated_at: '2026-11-02T10:00:00Z',
    interval_description: '14 days since last visit (2026-10-19)',
  };

  it('renders ungenerated state with a call-to-action button when summary is null', () => {
    const html = renderToStaticMarkup(
      <PreVisitAiBriefCard summary={null} onGenerate={() => {}} isGenerating={false} />
    );

    expect(html).toContain('AI Pre-Visit Clinical Brief');
    expect(html).toContain('Generate Pre-Visit Brief');
    expect(html).toContain('Synthesize the patient&#x27;s interval check-ins');
  });

  it('renders loading state when brief is actively being generated', () => {
    const html = renderToStaticMarkup(
      <PreVisitAiBriefCard summary={null} onGenerate={() => {}} isGenerating={true} />
    );

    expect(html).toContain('Synthesizing...');
  });

  it('renders urgent priority status and surfaces red flags prominently', () => {
    const html = renderToStaticMarkup(
      <PreVisitAiBriefCard summary={mockUrgentSummary} />
    );

    expect(html).toContain('Pre-Visit Clinical Brief');
    expect(html).toContain('Urgent Priority');
    expect(html).toContain('Priority Obstetric Alerts (2)');
    expect(html).toContain('Persistent severe headache reported');
    expect(html).toContain('Decreased fetal kicks in past 24h');
  });

  it('renders routine baseline status when risk level is low', () => {
    const html = renderToStaticMarkup(
      <PreVisitAiBriefCard summary={mockRoutineSummary} />
    );

    expect(html).toContain('Routine Baseline');
    expect(html).not.toContain('Priority Obstetric Alerts');
  });

  it('renders the 3 diagnostic pillars (Physical, Emotional, Routine)', () => {
    const html = renderToStaticMarkup(
      <PreVisitAiBriefCard summary={mockUrgentSummary} />
    );

    // Physical
    expect(html).toContain('Physical Sensations');
    expect(html).toContain('Bilateral ankle swelling began at week 26 and has escalated.');

    // Mental
    expect(html).toContain('Emotional Well-Being');
    expect(html).toContain('Elevated anxiety regarding labor; restless sleep reported.');

    // Medical Routine
    expect(html).toContain('Daily Routine &amp; Meds');
    expect(html).toContain('100% adherence to daily prenatal iron and vitamins.');
  });

  it('renders patient top questions and doctor action points', () => {
    const html = renderToStaticMarkup(
      <PreVisitAiBriefCard summary={mockUrgentSummary} />
    );

    expect(html).toContain('Patient&#x27;s Agenda for Today');
    expect(html).toContain('Is sudden swelling in my feet dangerous at week 28?');

    expect(html).toContain('Suggested Clinical Focus');
    expect(html).toContain('Check urine protein dipstick and re-evaluate BP.');
  });

  it('includes mandatory safety disclaimer: flags and prioritises, never diagnoses', () => {
    const html = renderToStaticMarkup(
      <PreVisitAiBriefCard summary={mockRoutineSummary} />
    );

    expect(html).toContain('Clinical decision support only');
    expect(html).toContain('Flags and prioritises, never diagnoses');
  });

  it('renders interval scoping description when present', () => {
    const html = renderToStaticMarkup(
      <PreVisitAiBriefCard summary={mockUrgentSummary} />
    );

    expect(html).toContain('Interval: 14 days since last visit (2026-10-19)');
  });
});

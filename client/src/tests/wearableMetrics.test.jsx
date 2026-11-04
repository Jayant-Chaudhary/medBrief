import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WearableMetricsCard } from '../components/clinician/WearableMetricsCard.jsx';

describe('WearableMetricsCard Component', () => {
  const mockEmptyTrajectory = {
    hasData: false,
    daysTracked: 0,
    flags: [],
  };

  const mockActiveTrajectory = {
    hasData: true,
    daysTracked: 14,
    avgRecentSteps: 6450,
    avgPriorSteps: 6200,
    stepsTrendPercent: 4,
    avgRestingHr: 76.5,
    peakRestingHr: 82,
    avgSleepHours: 7.4,
    flags: [],
    mobilityAlert: false,
    tachycardiaAlert: false,
    sleepDeficitAlert: false,
    bpAlert: false,
    dailyMetrics: [
      {
        metricDate: '2026-11-03',
        steps: 6800,
        restingHeartRate: 75.0,
        sleepMinutes: 450,
      },
      {
        metricDate: '2026-11-02',
        steps: 7100,
        restingHeartRate: 77.0,
        sleepMinutes: 430,
      },
    ],
  };

  const mockAlertTrajectory = {
    hasData: true,
    daysTracked: 14,
    avgRecentSteps: 2100,
    avgPriorSteps: 6400,
    stepsTrendPercent: -67,
    avgRestingHr: 88.5,
    peakRestingHr: 104,
    avgSleepHours: 5.1,
    latestBp: { systolic: 142, diastolic: 92, metricDate: '2026-11-03' },
    latestWeight: 68.5,
    flags: [
      'Marked physical mobility drop: daily steps reduced by 67% over the last 7 days',
      'Elevated resting heart rate observed: peaked at 104 bpm (interval average: 88.5 bpm)',
      'Wearable/home blood pressure alert: recorded at 142/92 mmHg',
    ],
    mobilityAlert: true,
    tachycardiaAlert: true,
    sleepDeficitAlert: true,
    bpAlert: true,
    dailyMetrics: [
      {
        metricDate: '2026-11-03',
        steps: 1200,
        restingHeartRate: 104.0,
        sleepMinutes: 280,
      },
    ],
  };

  it('renders no-sync placeholder when trajectory is empty or null', () => {
    const html = renderToStaticMarkup(<WearableMetricsCard trajectory={mockEmptyTrajectory} />);
    expect(html).toContain('Physical Activity &amp; Wearables');
    expect(html).toContain('No Health Connect wearable data synced');
    expect(html).toContain('No Sync');
  });

  it('renders executive glanceable card with recent activity, trajectory, and vitals', () => {
    const html = renderToStaticMarkup(<WearableMetricsCard trajectory={mockActiveTrajectory} />);
    expect(html).toContain('Physical Activity &amp; Wearables');
    expect(html).toContain('Health Connect Verified');
    expect(html).toContain('+4%');
    expect(html).toContain('vs prior week');
    expect(html).toContain('76.5 bpm');
    expect(html).toContain('7.4 hrs');
    expect(html).toContain('Inspect Full Activity &amp; Telemetry Log (14 days)');
  });

  it('renders alert chip and flags when tachycardia and mobility drop are detected', () => {
    const html = renderToStaticMarkup(<WearableMetricsCard trajectory={mockAlertTrajectory} />);
    expect(html).toContain('Vitals Alert');
    expect(html).toContain('104 bpm (Elevated)');
    expect(html).toContain('-67%');
    expect(html).toContain('Marked Mobility Drop');
    expect(html).toContain('Wearable BP:');
    expect(html).toContain('142/92 mmHg');
    expect(html).toContain('Logged Weight:');
    expect(html).toContain('68.5 kg');
    expect(html).toContain('Marked physical mobility drop: daily steps reduced by 67%');
    expect(html).toContain('Elevated resting heart rate observed: peaked at 104 bpm');
  });

  it('displays the non-negotiable non-diagnostic safety disclaimer', () => {
    const html = renderToStaticMarkup(<WearableMetricsCard trajectory={mockActiveTrajectory} />);
    expect(html).toContain('flags and prioritises, never diagnoses');
  });
});

/**
 * Distribution chart showing account counts by weekly quota percentage buckets.
 */

import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Tooltip,
  Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import { useThemeStore } from '@/stores';
import styles from './WeeklyQuotaChart.module.scss';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Tooltip, Legend);

interface QuotaWindowLike {
  id?: string;
  usedPercent?: number | null;
}

interface QuotaEntry {
  status?: string;
  windows?: QuotaWindowLike[];
}

interface Props {
  quota: Record<string, QuotaEntry | undefined>;
  fileNames: string[];
}

const BUCKETS = [
  '0%', '1-10%', '11-20%', '21-30%', '31-40%',
  '41-50%', '51-60%', '61-70%', '71-80%', '81-90%', '91-99%', '100%'
];

function getBucketIndex(percent: number): number {
  if (percent <= 0) return 0;
  if (percent >= 100) return 11;
  return Math.ceil(percent / 10);
}

function getWeeklyRemainingPercent(entry?: QuotaEntry): number | null {
  if (!entry || entry.status !== 'success') return null;
  const weeklyWindow = entry.windows?.find((w) => w.id === 'weekly');
  if (!weeklyWindow) return null;
  const used = weeklyWindow.usedPercent;
  if (typeof used !== 'number' || Number.isNaN(used)) return null;
  return Math.max(0, Math.min(100, 100 - used));
}

export function WeeklyQuotaChart({ quota, fileNames }: Props) {
  const isDark = useThemeStore((s) => s.resolvedTheme) === 'dark';

  const { counts, noDataCount } = useMemo(() => {
    const c = new Array<number>(BUCKETS.length).fill(0);
    let noData = 0;
    for (const name of fileNames) {
      const pct = getWeeklyRemainingPercent(quota[name]);
      if (pct === null) {
        noData++;
      } else {
        c[getBucketIndex(pct)]++;
      }
    }
    return { counts: c, noDataCount: noData };
  }, [quota, fileNames]);

  const hasData = counts.some((c) => c > 0);

  const chartData = useMemo(() => {
    const barColors = counts.map((_, i) => {
      if (i === 0) return isDark ? 'rgba(239, 68, 68, 0.7)' : 'rgba(239, 68, 68, 0.75)';
      if (i <= 4) return isDark ? 'rgba(245, 158, 11, 0.6)' : 'rgba(245, 158, 11, 0.7)';
      if (i <= 8) return isDark ? 'rgba(59, 130, 246, 0.6)' : 'rgba(59, 130, 246, 0.65)';
      return isDark ? 'rgba(34, 197, 94, 0.65)' : 'rgba(34, 197, 94, 0.7)';
    });

    const borderColors = counts.map((_, i) => {
      if (i === 0) return 'rgba(239, 68, 68, 1)';
      if (i <= 4) return 'rgba(245, 158, 11, 1)';
      if (i <= 8) return 'rgba(59, 130, 246, 1)';
      return 'rgba(34, 197, 94, 1)';
    });

    return {
      labels: BUCKETS,
      datasets: [
        {
          label: '账号数',
          data: counts,
          backgroundColor: barColors,
          borderColor: borderColors,
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false as const
        }
      ]
    };
  }, [counts, isDark]);

  const options = useMemo((): ChartOptions<'bar'> => {
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(17,24,39,0.06)';
    const tickColor = isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,24,39,0.72)';
    const tooltipBg = isDark ? 'rgba(17,24,39,0.92)' : 'rgba(255,255,255,0.98)';
    const tooltipTitle = isDark ? '#fff' : '#111827';
    const tooltipBody = isDark ? 'rgba(255,255,255,0.86)' : '#374151';
    const tooltipBorder = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(17,24,39,0.10)';
    const maxVal = Math.max(...counts, 1);

    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: tooltipTitle,
          bodyColor: tooltipBody,
          borderColor: tooltipBorder,
          borderWidth: 1,
          padding: 10,
          callbacks: {
            title: (items) => `周限额剩余: ${items[0]?.label ?? ''}`,
            label: (item) => `  ${item.raw} 个账号`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: tickColor,
            font: { size: 11 }
          }
        },
        y: {
          beginAtZero: true,
          suggestedMax: maxVal + Math.max(1, Math.ceil(maxVal * 0.15)),
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            font: { size: 11 },
            stepSize: maxVal <= 10 ? 1 : undefined
          }
        }
      }
    };
  }, [isDark, counts]);

  if (!hasData) return null;

  return (
    <div className={styles.chartContainer}>
      <div className={styles.chartHeader}>
        <span className={styles.chartTitle}>周限额分布</span>
        {noDataCount > 0 && (
          <span className={styles.chartNote}>({noDataCount} 个账号未检测)</span>
        )}
      </div>
      <div className={styles.chartBody}>
        <Bar data={chartData} options={options} />
      </div>
    </div>
  );
}

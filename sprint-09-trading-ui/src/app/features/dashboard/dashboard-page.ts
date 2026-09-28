import { AfterViewInit, Component, ElementRef, OnDestroy, viewChild } from '@angular/core';
import ApexCharts from 'apexcharts';
import type { ApexOptions } from 'apexcharts';

const ORDER_FLOW_CHART_OPTIONS: ApexOptions = {
  series: [
    { name: 'Buys', data: [44, 55, 41, 67, 52, 70, 61, 85] },
    { name: 'Sells', data: [23, 33, 30, 48, 34, 45, 40, 45] }
  ],
  chart: { type: 'bar', height: 220, stacked: false, toolbar: { show: false }, zoom: { enabled: false }, fontFamily: 'Plus Jakarta Sans, sans-serif' },
  colors: ['#072F1F', '#B4F105'],
  states: { hover: { filter: { type: 'none' } } },
  plotOptions: { bar: { horizontal: false, columnWidth: '48%', borderRadius: 0 } },
  dataLabels: { enabled: false },
  stroke: { show: true, width: 2, colors: ['transparent'] },
  legend: { show: false },
  grid: {
    borderColor: '#E9EFEF',
    strokeDashArray: 4,
    yaxis: { lines: { show: true } },
    xaxis: { lines: { show: false } },
    padding: { top: 0, right: 0, bottom: 0, left: 0 }
  },
  xaxis: {
    categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
    labels: { style: { colors: '#6C7E75', fontSize: '11px', fontWeight: 500 } },
    axisBorder: { show: false },
    axisTicks: { show: false }
  },
  yaxis: { labels: { show: false } },
  fill: { opacity: 1 },
  tooltip: { y: { formatter: (val: number) => `${val} orders` }, theme: 'dark' }
};

const ALLOCATION_CHART_OPTIONS: ApexOptions = {
  series: [62, 25, 13],
  chart: { type: 'donut', height: 250, fontFamily: 'Plus Jakarta Sans, sans-serif' },
  labels: ['Equity', 'Cash', 'Crypto'],
  colors: ['#B4F105', '#051C12', '#F97316'],
  states: { hover: { filter: { type: 'none' } } },
  legend: { show: false },
  dataLabels: { enabled: false },
  plotOptions: {
    pie: {
      donut: {
        size: '72%',
        background: 'transparent',
        labels: {
          show: true,
          name: { show: true, fontSize: '12px', fontWeight: 500, color: '#6C7E75', offsetY: -8 },
          value: {
            show: true,
            fontSize: '26px',
            fontWeight: 800,
            color: '#0B130F',
            offsetY: 8,
            formatter: (val: string) => `${val}%`
          },
          total: {
            show: true,
            label: 'Portfolio Value',
            fontSize: '11px',
            fontWeight: 500,
            color: '#6C7E75',
            formatter: () => '₹5.4L'
          }
        }
      }
    }
  },
  tooltip: { theme: 'dark' }
};

function sparklineOptions(data: number[], color: string): ApexOptions {
  return {
    series: [{ data }],
    chart: { type: 'area', height: 45, sparkline: { enabled: true }, fontFamily: 'Plus Jakarta Sans, sans-serif' },
    stroke: { curve: 'smooth', width: 2 },
    fill: { opacity: 0.1, type: 'solid' },
    colors: [color],
    tooltip: { fixed: { enabled: false }, x: { show: false }, y: { title: { formatter: () => '' } }, marker: { show: false } }
  };
}

@Component({
  selector: 'tui-dashboard-page',
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css'
})
export class DashboardPage implements AfterViewInit, OnDestroy {
  private readonly orderFlowChartEl = viewChild.required<ElementRef<HTMLElement>>('orderFlowChart');
  private readonly allocationChartEl = viewChild.required<ElementRef<HTMLElement>>('allocationChart');
  private readonly portfolioSparkEl = viewChild.required<ElementRef<HTMLElement>>('portfolioSpark');
  private readonly pnlSparkEl = viewChild.required<ElementRef<HTMLElement>>('pnlSpark');

  private charts: ApexCharts[] = [];

  ngAfterViewInit(): void {
    this.charts = [
      new ApexCharts(this.orderFlowChartEl().nativeElement, ORDER_FLOW_CHART_OPTIONS),
      new ApexCharts(this.allocationChartEl().nativeElement, ALLOCATION_CHART_OPTIONS),
      new ApexCharts(
        this.portfolioSparkEl().nativeElement,
        sparklineOptions([45, 51, 46, 58, 50, 62, 55, 72, 65, 79, 70, 85], '#22C55E')
      ),
      new ApexCharts(
        this.pnlSparkEl().nativeElement,
        sparklineOptions([50, 48, 55, 45, 40, 38, 42, 35, 30, 28, 32, 24], '#EF4444')
      )
    ];
    this.charts.forEach((chart) => chart.render());
  }

  ngOnDestroy(): void {
    this.charts.forEach((chart) => chart.destroy());
  }
}

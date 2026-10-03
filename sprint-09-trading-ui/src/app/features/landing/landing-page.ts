import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './landing-page.html',
  styleUrls: ['./landing-page.css']
})
export class LandingPage {
  features = [
    {
      icon: 'bi-lightning-charge-fill',
      title: 'Real-Time Trading',
      description: 'Execute orders instantly with live market data and instant confirmations'
    },
    {
      icon: 'bi-graph-up',
      title: 'Portfolio Analytics',
      description: 'Track your investments with comprehensive analytics and performance metrics'
    },
    {
      icon: 'bi-shield-check',
      title: 'Secure & Reliable',
      description: 'Enterprise-grade security with industry-leading infrastructure and uptime'
    },
    {
      icon: 'bi-activity',
      title: 'Advanced Monitoring',
      description: 'Real-time alerts and notifications for your trades and market movements'
    },
    {
      icon: 'bi-gear-fill',
      title: 'Smart Tools',
      description: 'Powerful order management and automated trading capabilities'
    },
    {
      icon: 'bi-people-fill',
      title: '24/7 Support',
      description: 'Round-the-clock customer support to help with your trading needs'
    }
  ];

  scrollToSection(sectionId: string) {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  }
}

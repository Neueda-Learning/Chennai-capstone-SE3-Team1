export * from './accounts.service';
import { AccountsService } from './accounts.service';
export * from './funding.service';
import { FundingService } from './funding.service';
export * from './onboarding.service';
import { OnboardingService } from './onboarding.service';
export * from './orders.service';
import { OrdersService } from './orders.service';
export const APIS = [AccountsService, FundingService, OnboardingService, OrdersService];

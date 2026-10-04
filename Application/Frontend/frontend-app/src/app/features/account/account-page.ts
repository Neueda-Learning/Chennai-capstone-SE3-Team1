import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Avatar } from '../../core/user/avatar';
import { UserProfileStore } from '../../core/user/user-profile.store';

/**
 * Who you are, as the platform has you on record: the login (username, email, phone, roles) and
 * the trading account behind it (holder, bank, status). Read-only: neither service offers a way
 * to edit these from the browser yet, and the page says so rather than showing fields that
 * would not save.
 */
@Component({
  selector: 'tui-account-page',
  imports: [RouterLink, Avatar],
  templateUrl: './account-page.html',
  styleUrl: './account-page.css'
})
export class AccountPage {
  protected readonly profile = inject(UserProfileStore);

  protected readonly user = this.profile.userRecord;
  protected readonly account = this.profile.accountRecord;

  protected readonly memberSince = computed(() => {
    const created = this.user()?.createdOn;
    const date = created ? new Date(created) : null;
    return date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;
  });
}

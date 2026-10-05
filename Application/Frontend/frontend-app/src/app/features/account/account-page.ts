import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Avatar } from '../../core/user/avatar';
import { UserProfileStore } from '../../core/user/user-profile.store';

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

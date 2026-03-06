export function getInstitutionAccessStatus(institution, now = new Date()) {
  if (!institution) {
    return {
      allowed: false,
      reason: 'Institution not found.'
    };
  }

  if (!institution.isActive) {
    return {
      allowed: false,
      reason: 'Institution is inactive. Contact LIFT support.'
    };
  }

  if (String(institution.paymentStatus || '').toLowerCase() === 'cancelled') {
    return {
      allowed: false,
      reason: 'Subscription is cancelled. Renew plan to continue.'
    };
  }

  if (institution.subscriptionEndsAt) {
    const endTime = new Date(institution.subscriptionEndsAt).getTime();
    if (Number.isFinite(endTime) && endTime < now.getTime()) {
      return {
        allowed: false,
        reason: 'Subscription has expired. Renew plan to continue.'
      };
    }
  }

  return {
    allowed: true,
    reason: ''
  };
}

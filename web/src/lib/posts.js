// Convierte una publicación recibida de la API en el cuerpo de PUT /api/posts/:id
export function postToBody(post, patch = {}) {
  return {
    type: post.type,
    caption: post.caption || '',
    media_ids: (post.media || []).map((m) => m.id),
    targets: (post.targets || []).map((t) => ({
      account_id: t.account_id,
      caption: t.caption_override != null ? t.caption_override : null,
      options: t.options || {},
    })),
    scheduled_at: post.scheduled_at || null,
    action: post.status === 'draft' ? 'draft' : 'schedule',
    campaign_id: post.campaign ? post.campaign.id : null,
    notes: post.notes || '',
    ...patch,
  };
}

// Hora por defecto al elegir un día en el calendario (vista de mes: primera hora de la cola)
export function defaultTimeOn(date, queueTimes, keepTime) {
  const d = new Date(date);
  if (!keepTime) {
    const [h, m] = (queueTimes[0] || '09:00').split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  const now = new Date();
  if (d < now) {
    const today = d.toDateString() === now.toDateString();
    if (today) {
      const n = new Date(now.getTime() + 3600e3);
      n.setMinutes(0, 0, 0);
      return n;
    }
  }
  return d;
}

export const firstNetwork = (post) => (post.targets && post.targets[0] ? post.targets[0].network : null);

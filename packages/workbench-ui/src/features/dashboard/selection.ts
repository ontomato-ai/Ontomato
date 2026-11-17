import { readonly, ref } from "vue";
import type { PageSelection } from "@ontomato/agent-shell-ui";

/**
 * What the reader has selected in the dashboard page, for the message sent from beside it (DESIGN.md "Applications and
 * shells"): the board, and the card chosen in it. The dashboard's own component reports here while it is mounted and the
 * agent platform reads it when it writes its page context, so a selection is the page's own fact and no second copy of
 * it is kept.
 *
 * The board is always the first entry: a card means nothing to an agent without the board that holds it, and the page's
 * skill reads a card by its board and card ids. One page load shows one board, so this holds one page's selection, which
 * the dashboard clears when it goes.
 */
const selected = ref<readonly PageSelection[]>([]);

/** The selection the dashboard page reports, as the shell reads it. */
export const dashboardSelection = readonly(selected);

export function setDashboardSelection(
  board: { id: string; name: string },
  card?: { id: string; name: string; kind: "chart" | "metric" },
): void {
  selected.value = board.id
    ? [
      { kind: "dashboard", id: board.id, label: board.name },
      ...(card ? [{ kind: `dashboard-card-${card.kind}`, id: card.id, label: card.name }] : []),
    ]
    : [];
}

export function clearDashboardSelection(): void {
  selected.value = [];
}

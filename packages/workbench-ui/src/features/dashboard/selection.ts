import type { PageSelection } from "@ontomato/agent-shell-ui";

/**
 * What the reader has selected in the dashboard page, as the message sent from beside it says it (DESIGN.md
 * "Applications and shells"): the board, and the card chosen in it.
 *
 * The selection is the page's address, not a state of the component drawing it: choosing a card writes the card's id and
 * name into the address, the message travels with that address, and the board is drawn again from it (its `:key` is the
 * address). The page's skill reads a card by its board and card ids, and the message writes a selection's label alone, so
 * a label carries its name and its id both.
 */
export function dashboardSelectionFrom(address: {
  dashboardId?: string;
  dashboardName?: string;
  cardId?: string;
  cardName?: string;
}): readonly PageSelection[] {
  const board = address.dashboardId ?? "";
  if (!board) return [];
  const card = address.cardId ?? "";
  return [
    { kind: "dashboard", id: board, label: named(address.dashboardName, board) },
    ...(card ? [{ kind: "dashboard-card", id: card, label: named(address.cardName, card) }] : []),
  ];
}

/** A selection reads as its name and its id; without a name it reads as its id, which is still the object. */
function named(name: string | undefined, id: string): string {
  return name && name !== id ? `${name} (${id})` : id;
}

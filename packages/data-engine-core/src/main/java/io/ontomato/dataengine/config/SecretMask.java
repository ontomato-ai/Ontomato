package io.ontomato.dataengine.config;

import java.util.ArrayList;
import java.util.List;

/**
 * The write-only rule shared by every saved secret (model and Embedding keys, data adapter
 * connection secrets): a read for the page shows a mask instead of the value, and a save or
 * test that sends the mask back keeps the stored value. Each owner decides only which of its
 * fields are secrets and which {@link Style} they show.
 *
 * <p>A mask always starts with {@link #PREFIX}, which no real secret is expected to start
 * with. A mask that matches no stored value is refused instead of being saved as the secret.</p>
 */
public final class SecretMask {

    public static final String PREFIX = "******";
    private static final int TAIL = 4;
    private static final int MIN_LENGTH_FOR_TAIL = 8;

    public enum Style {
        /** {@code ******}: for passwords, where any part of the value is too much. */
        HIDDEN,
        /**
         * {@code ******} plus the last four characters, so several API keys can be told apart;
         * a value of eight characters or fewer shows the bare prefix.
         */
        TAIL
    }

    private SecretMask() {
    }

    public static String mask(String value, Style style) {
        if (value == null || value.isEmpty()) {
            return value;
        }
        return style == Style.TAIL && value.length() > MIN_LENGTH_FOR_TAIL
                ? PREFIX + value.substring(value.length() - TAIL)
                : PREFIX;
    }

    public static boolean isMasked(String value) {
        return value != null && value.startsWith(PREFIX);
    }

    /** The value to save for one submitted secret: the stored value when its mask is sent back. */
    public static String restore(String owner, String incoming, String stored, Style style) {
        if (!isMasked(incoming)) {
            return incoming;
        }
        if (stored == null || !incoming.equals(mask(stored, style))) {
            throw unmatched(owner, incoming);
        }
        return stored;
    }

    /**
     * The values to save for a submitted list. Masks are matched in order and each stored value
     * is used once, so two values with the same mask map back to themselves.
     */
    public static List<String> restoreAll(String owner, List<String> incoming, List<String> stored, Style style) {
        if (incoming == null || incoming.stream().noneMatch(SecretMask::isMasked)) {
            return incoming;
        }
        List<String> unused = stored == null ? new ArrayList<>() : new ArrayList<>(stored);
        List<String> restored = new ArrayList<>(incoming.size());
        for (String value : incoming) {
            if (!isMasked(value)) {
                restored.add(value);
                continue;
            }
            int index = -1;
            for (int i = 0; i < unused.size() && index < 0; i++) {
                if (value.equals(mask(unused.get(i), style))) {
                    index = i;
                }
            }
            if (index < 0) {
                throw unmatched(owner, value);
            }
            restored.add(unused.remove(index));
        }
        return restored;
    }

    private static IllegalArgumentException unmatched(String owner, String mask) {
        return new IllegalArgumentException(
                "The secret " + mask + " of " + owner + " does not match a saved value; enter it again");
    }
}

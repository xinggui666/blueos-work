package icu.liuhua.workshop;

import java.util.Arrays;

/** Fail-closed signer-set continuity. Key rotation needs a separate reviewed policy. */
final class SigningPolicy {
    private SigningPolicy() {}
    static boolean sameSigners(byte[][] current, byte[][] candidate) {
        if (current == null || candidate == null || current.length == 0 || current.length != candidate.length) return false;
        boolean[] used = new boolean[candidate.length];
        for (byte[] signer : current) {
            if (signer == null || signer.length == 0) return false;
            boolean found = false;
            for (int i = 0; i < candidate.length; i++) {
                if (!used[i] && Arrays.equals(signer, candidate[i])) { used[i] = true; found = true; break; }
            }
            if (!found) return false;
        }
        return true;
    }
}

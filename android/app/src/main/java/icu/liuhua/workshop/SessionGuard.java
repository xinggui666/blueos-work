package icu.liuhua.workshop;
import java.util.function.Supplier;
/** Shared lock for credential pairs, login epochs, logout and Activity lifetime. No secrets stored here. */
final class SessionGuard {
    private long generation;
    private boolean closed;
    synchronized long begin() { requireOpen(); return ++generation; }
    synchronized boolean commit(long expected, Runnable mutation) {
        if (closed || generation != expected) return false;
        mutation.run(); return true;
    }
    synchronized <T> T read(Supplier<T> read) { requireOpen(); return read.get(); }
    synchronized <T> T clear(Supplier<T> mutation) { requireOpen(); ++generation; return mutation.get(); }
    synchronized void invalidate() { requireOpen(); ++generation; }
    synchronized void close() { closed = true; ++generation; }
    private void requireOpen() { if (closed) throw new IllegalStateException("bridge closed"); }
}

package icu.liuhua.workshop;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
public class SessionGuardTest {
    @Test public void supersededLoginCannotCommit() { SessionGuard g=new SessionGuard(); AtomicInteger state=new AtomicInteger(); long a=g.begin(),b=g.begin(); assertFalse(g.commit(a,()->state.set(1))); assertTrue(g.commit(b,()->state.set(2))); assertEquals(2,state.get()); }
    @Test public void reloadInvalidatesPendingButPreservesSavedState() { SessionGuard g=new SessionGuard();AtomicInteger saved=new AtomicInteger(7);long epoch=g.begin();g.invalidate();assertEquals(7,g.read(saved::get).intValue());assertFalse(g.commit(epoch,()->saved.set(8))); }
    @Test public void logoutInvalidatesPendingLogin() { SessionGuard g=new SessionGuard(); long a=g.begin(); g.clear(()->null); assertFalse(g.commit(a,()->fail("stale login"))); }
    @Test public void closedActivityCannotCommitOrRead() { SessionGuard g=new SessionGuard(); long a=g.begin(); g.close(); assertFalse(g.commit(a,()->fail("closed login"))); try { g.read(()->null); fail(); } catch(IllegalStateException expected) {} }
    @Test public void credentialPairNeverTearsAcrossServers() throws Exception {
        SessionGuard g=new SessionGuard();String[] pair={"A","A"};ExecutorService pool=Executors.newFixedThreadPool(2);
        try { Future<?> writer=pool.submit(()->{for(int i=0;i<10000;i++){final String value=i%2==0?"A":"B";g.clear(()->{pair[0]=value;Thread.yield();pair[1]=value;return null;});}});
            Future<?> reader=pool.submit(()->{for(int i=0;i<10000;i++) {String[] copy=g.read(()->pair.clone());assertEquals(copy[0],copy[1]);}});writer.get();reader.get();
        } finally {pool.shutdownNow();}
    }
    @Test public void concurrentLogoutAndCommitEndSignedOut() throws Exception {
        ExecutorService pool=Executors.newFixedThreadPool(2);try {for(int i=0;i<100;i++){SessionGuard g=new SessionGuard();AtomicInteger state=new AtomicInteger();long epoch=g.begin();CountDownLatch start=new CountDownLatch(1);
            Future<?> login=pool.submit(()->{try{start.await();}catch(InterruptedException e){throw new RuntimeException(e);}g.commit(epoch,()->state.set(1));});
            Future<?> logout=pool.submit(()->{try{start.await();}catch(InterruptedException e){throw new RuntimeException(e);}g.clear(()->{state.set(0);return null;});});start.countDown();login.get();logout.get();assertEquals(0,state.get());
        }}finally{pool.shutdownNow();}
    }
}

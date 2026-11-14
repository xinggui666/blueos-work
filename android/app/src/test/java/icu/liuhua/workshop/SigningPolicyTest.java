package icu.liuhua.workshop;
import org.junit.Test;
import static org.junit.Assert.*;
public class SigningPolicyTest {
    @Test public void sameSignerAccepted() { assertTrue(SigningPolicy.sameSigners(new byte[][]{{1,2}},new byte[][]{{1,2}})); }
    @Test public void changedSignerRejected() { assertFalse(SigningPolicy.sameSigners(new byte[][]{{1,2}},new byte[][]{{1,3}})); }
    @Test public void missingSignersRejected() { assertFalse(SigningPolicy.sameSigners(null,new byte[][]{{1}})); assertFalse(SigningPolicy.sameSigners(new byte[0][],new byte[0][])); assertFalse(SigningPolicy.sameSigners(new byte[][]{null},new byte[][]{null})); }
    @Test public void multipleSignerOrderIrrelevant() { assertTrue(SigningPolicy.sameSigners(new byte[][]{{1},{2}},new byte[][]{{2},{1}})); }
    @Test public void missingOrDuplicatedSignerRejected() { assertFalse(SigningPolicy.sameSigners(new byte[][]{{1},{2}},new byte[][]{{1},{1}})); assertFalse(SigningPolicy.sameSigners(new byte[][]{{1},{2}},new byte[][]{{1}})); }
}

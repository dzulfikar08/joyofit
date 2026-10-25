/*  Copyright (C) 2022-2023 Martin.JM

    This file is part of Gadgetbridge.

    Gadgetbridge is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Gadgetbridge is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>. */
package nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets;

import static nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl.Control.Response.Button;

import java.lang.reflect.Field;
import java.util.List;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums;

import org.junit.Assert;
import org.junit.Test;

public class TestMusicControl {

    HuaweiPacket.ParamsProvider secretsProvider = new HuaweiPacket.ParamsProvider() {
        @Override public byte getDeviceSupportType() { return 0; }
        @Override public byte[] getSecretKey() { return new byte[16]; }
        @Override public byte[] getIv() { return new byte[16]; }
        @Override public boolean areTransactionsCrypted() { return true; }
        @Override public int getMtu() { return 0; }
        @Override public int getSliceSize() { return 0xF4; }
    };

    private MusicControl.Control.Response parseControl(byte[] tlv) throws HuaweiPacket.ParseException {
        MusicControl.Control.Response r = (MusicControl.Control.Response) new HuaweiPacket(secretsProvider).parse(frame(0x25, 0x03, tlv));
        r.parseTlv();
        return r;
    }

    private static byte[] frame(int service, int command, byte[] tlv) {
        byte[] head = new byte[6 + tlv.length];
        int len = 3 + tlv.length;
        head[0] = 0x5a;
        head[1] = (byte) ((len >> 8) & 0xff);
        head[2] = (byte) (len & 0xff);
        head[3] = 0x00;
        head[4] = (byte) service;
        head[5] = (byte) command;
        System.arraycopy(tlv, 0, head, 6, tlv.length);
        int crc = CheckSums.getCRC16(head, 0x0000);
        byte[] out = new byte[head.length + 2];
        System.arraycopy(head, 0, out, 0, head.length);
        out[head.length] = (byte) ((crc >> 8) & 0xff);
        out[head.length + 1] = (byte) (crc & 0xff);
        return out;
    }

    @Test
    public void testMusicStatusRequest() throws NoSuchFieldException, IllegalAccessException, HuaweiPacket.CryptoException {
        int okInput = 0x000186a0;
        int errInput = 0x00000000;

        byte commandId1 = 0x01;
        byte commandId2 = 0x02;

        Field tlvField = HuaweiPacket.class.getDeclaredField("tlv");
        tlvField.setAccessible(true);

        HuaweiTLV okExpectedTlv = new HuaweiTLV().put(0x7f, okInput);
        HuaweiTLV errExpectedTlv = new HuaweiTLV().put(0x7f, errInput);

        MusicControl.MusicStatusRequest okRequest = new MusicControl.MusicStatusRequest(secretsProvider, commandId1, okInput);
        MusicControl.MusicStatusRequest errRequest = new MusicControl.MusicStatusRequest(secretsProvider, commandId2, errInput);

        Assert.assertEquals(0x25, okRequest.serviceId);
        Assert.assertEquals(commandId1, okRequest.commandId);
        Assert.assertEquals(okExpectedTlv, tlvField.get(okRequest));
        Assert.assertTrue(okRequest.complete);
        okRequest.serialize();

        Assert.assertEquals(0x25, errRequest.serviceId);
        Assert.assertEquals(commandId2, errRequest.commandId);
        Assert.assertEquals(errExpectedTlv, tlvField.get(errRequest));
        Assert.assertTrue(errRequest.complete);
        errRequest.serialize();
    }

    @Test
    public void testMusicStatusResponse() throws NoSuchFieldException, IllegalAccessException, HuaweiPacket.ParseException {
        byte[] raw = new byte[] {(byte) 0x5a, (byte) 0x00, (byte) 0x2a, (byte) 0x00, (byte) 0x25, (byte) 0x01, (byte) 0x7c, (byte) 0x01, (byte) 0x01, (byte) 0x7d, (byte) 0x10, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x7e, (byte) 0x10, (byte) 0x01, (byte) 0x43, (byte) 0xdb, (byte) 0x63, (byte) 0xee, (byte) 0x66, (byte) 0xb0, (byte) 0xcd, (byte) 0xff, (byte) 0x9f, (byte) 0x69, (byte) 0x91, (byte) 0x76, (byte) 0x80, (byte) 0x15, (byte) 0x1e, (byte) 0x52, (byte) 0x46};

        Field tlvField = HuaweiPacket.class.getDeclaredField("tlv");
        tlvField.setAccessible(true);

        HuaweiTLV expectedTlv = new HuaweiTLV();

        HuaweiPacket packet = new HuaweiPacket(secretsProvider).parse(raw);
        packet.parseTlv();

        Assert.assertEquals(0x25, packet.serviceId);
        Assert.assertEquals(0x01, packet.commandId);
        Assert.assertEquals(expectedTlv, tlvField.get(packet));
        Assert.assertTrue(packet instanceof MusicControl.MusicStatusResponse);
        Assert.assertEquals(-1, ((MusicControl.MusicStatusResponse) packet).status);
    }

    @Test
    public void testMusicStatusResponseUnencrypted() throws NoSuchFieldException, IllegalAccessException, HuaweiPacket.ParseException {
        byte[] rawOk = new byte[] {0x5a, 0x00, 0x09, 0x00, 0x25, 0x01, 0x7f, 0x04, 0x00, 0x01, (byte) 0x86, (byte) 0xa0, 0x63, (byte) 0x96};
        byte[] rawErr = new byte[] {0x5a, 0x00, 0x09, 0x00, 0x25, 0x01, 0x7f, 0x04, 0x00, 0x01, (byte) 0x86, (byte) 0xaa, (byte) 0xc2, (byte) 0xdc};

        Field tlvField = HuaweiPacket.class.getDeclaredField("tlv");
        tlvField.setAccessible(true);

        HuaweiTLV expectedTlvOk = new HuaweiTLV().put(0x7F, 0x000186A0);
        HuaweiTLV expectedTlvErr = new HuaweiTLV().put(0x7F, 0x000186AA);

        HuaweiPacket packetOk = new HuaweiPacket(secretsProvider).parse(rawOk);
        HuaweiPacket packetErr = new HuaweiPacket(secretsProvider).parse(rawErr);
        packetOk.parseTlv();
        packetErr.parseTlv();

        Assert.assertEquals(0x25, packetOk.serviceId);
        Assert.assertEquals(0x01, packetOk.commandId);
        Assert.assertEquals(expectedTlvOk, tlvField.get(packetOk));
        Assert.assertTrue(packetOk instanceof MusicControl.MusicStatusResponse);
        Assert.assertEquals(0x000186A0, ((MusicControl.MusicStatusResponse) packetOk).status);

        Assert.assertEquals(0x25, packetErr.serviceId);
        Assert.assertEquals(0x01, packetErr.commandId);
        Assert.assertEquals(expectedTlvErr, tlvField.get(packetErr));
        Assert.assertTrue(packetErr instanceof MusicControl.MusicStatusResponse);
        Assert.assertEquals(0x000186AA, ((MusicControl.MusicStatusResponse) packetErr).status);
    }

    @Test
    public void testMusicInfoRequest() throws NoSuchFieldException, IllegalAccessException, HuaweiPacket.CryptoException {
        String artistName = "Artist";
        String songName = "Song";
        byte playState = 0x01;
        byte maxVolume = 0x03;
        byte currentVolume = 0x02;
        HuaweiTLV expectedTlv = new HuaweiTLV()
                .put(0x01, artistName)
                .put(0x02, songName)
                .put(0x03, playState)
                .put(0x04, maxVolume)
                .put(0x05, currentVolume);
        byte[] expectedSerializedPacket = new byte[] {(byte) 0x5a, (byte) 0x00, (byte) 0x3a, (byte) 0x00, (byte) 0x25, (byte) 0x02, (byte) 0x7c, (byte) 0x01, (byte) 0x01, (byte) 0x7d, (byte) 0x10, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x7e, (byte) 0x20, (byte) 0x21, (byte) 0x8b, (byte) 0xe1, (byte) 0x3d, (byte) 0x9f, (byte) 0x85, (byte) 0xd2, (byte) 0x2e, (byte) 0x64, (byte) 0x87, (byte) 0x3f, (byte) 0x1d, (byte) 0xab, (byte) 0x3f, (byte) 0xc7, (byte) 0x39, (byte) 0xb6, (byte) 0x34, (byte) 0x89, (byte) 0x60, (byte) 0xa0, (byte) 0x36, (byte) 0x4a, (byte) 0x08, (byte) 0x7a, (byte) 0x16, (byte) 0xed, (byte) 0xc9, (byte) 0x9e, (byte) 0xf3, (byte) 0xbf, (byte) 0x44, (byte) 0xac, (byte) 0x58};

        Field tlvField = HuaweiPacket.class.getDeclaredField("tlv");
        tlvField.setAccessible(true);

        MusicControl.MusicInfo.Request musicInfoRequest = new MusicControl.MusicInfo.Request(
                secretsProvider,
                artistName,
                songName,
                playState,
                maxVolume,
                currentVolume
        );

        Assert.assertEquals(0x25, musicInfoRequest.serviceId);
        Assert.assertEquals(0x02, musicInfoRequest.commandId);
        Assert.assertEquals(expectedTlv, tlvField.get(musicInfoRequest));
        Assert.assertTrue(musicInfoRequest.complete);
        List<byte[]> out = musicInfoRequest.serialize();
        Assert.assertEquals(1, out.size());
        Assert.assertArrayEquals(expectedSerializedPacket, out.get(0));
    }

    @Test
    public void testMusicInfoResponse() throws NoSuchFieldException, IllegalAccessException, HuaweiPacket.ParseException {
        byte[] rawOk = new byte[] {(byte) 0x5a, (byte) 0x00, (byte) 0x09, (byte) 0x00, (byte) 0x25, (byte) 0x02, (byte) 0x7f, (byte) 0x04, (byte) 0x00, (byte) 0x01, (byte) 0x86, (byte) 0xA0, (byte) 0xbb, (byte) 0x14};
        byte[] rawErr = new byte[] {(byte) 0x5a, (byte) 0x00, (byte) 0x09, (byte) 0x00, (byte) 0x25, (byte) 0x02, (byte) 0x7f, (byte) 0x04, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x00, (byte) 0x88, (byte) 0xf0};
        byte[] rawMissing = new byte[] {(byte) 0x5a, (byte) 0x00, (byte) 0x03, (byte) 0x00, (byte) 0x25, (byte) 0x02, (byte) 0xb4, (byte) 0x1b};

        Field tlvField = HuaweiPacket.class.getDeclaredField("tlv");
        tlvField.setAccessible(true);

        HuaweiTLV okExpectedTlv = new HuaweiTLV().put(0x7f, 0x000186a0);
        HuaweiTLV errExpectedTlv = new HuaweiTLV().put(0x7f, 0x00000000);
        HuaweiTLV missingExpectedTlv = new HuaweiTLV();

        HuaweiPacket packetOk = new HuaweiPacket(secretsProvider).parse(rawOk);
        HuaweiPacket packetErr = new HuaweiPacket(secretsProvider).parse(rawErr);
        HuaweiPacket packetMissing = new HuaweiPacket(secretsProvider).parse(rawMissing);

        packetOk.parseTlv();
        packetErr.parseTlv();
        packetMissing.parseTlv();

        Assert.assertEquals(0x25, packetOk.serviceId);
        Assert.assertEquals(0x02, packetOk.commandId);
        Assert.assertEquals(okExpectedTlv, tlvField.get(packetOk));
        Assert.assertTrue(packetOk instanceof MusicControl.MusicInfo.Response);
        Assert.assertTrue(((MusicControl.MusicInfo.Response) packetOk).ok);
        Assert.assertEquals("", ((MusicControl.MusicInfo.Response) packetOk).error);

        Assert.assertEquals(0x25, packetErr.serviceId);
        Assert.assertEquals(0x02, packetErr.commandId);
        Assert.assertEquals(errExpectedTlv, tlvField.get(packetErr));
        Assert.assertTrue(packetErr instanceof MusicControl.MusicInfo.Response);
        Assert.assertFalse(((MusicControl.MusicInfo.Response) packetErr).ok);
        Assert.assertEquals("Music information error code: 0", ((MusicControl.MusicInfo.Response) packetErr).error);

        Assert.assertEquals(0x25, packetMissing.serviceId);
        Assert.assertEquals(0x02, packetMissing.commandId);
        Assert.assertEquals(missingExpectedTlv, tlvField.get(packetMissing));
        Assert.assertTrue(packetMissing instanceof MusicControl.MusicInfo.Response);
        Assert.assertFalse(((MusicControl.MusicInfo.Response) packetMissing).ok);
        Assert.assertEquals("Music information response no status tag", ((MusicControl.MusicInfo.Response) packetMissing).error);
    }

    @Test
    public void testControlResponseAndAdversarialEmptyTags() throws HuaweiPacket.ParseException {
        MusicControl.Control.Response emptyResp = parseControl(new byte[0]);
        Assert.assertFalse(emptyResp.buttonPresent);
        Assert.assertFalse(emptyResp.volumePresent);

        byte[] codes = {1, 2, 3, 4, 5, 6, (byte) 0xFF};
        Button[] expected = {Button.Play, Button.Pause, Button.Previous, Button.Next, Button.Volume_up, Button.Volume_down, Button.Unknown};
        for (int i = 0; i < codes.length; i++) {
            MusicControl.Control.Response r = parseControl(new byte[] {0x01, 0x01, codes[i]});
            Assert.assertTrue(r.buttonPresent);
            Assert.assertEquals(expected[i], r.button);
        }

        MusicControl.Control.Response exitResp = parseControl(new byte[] {0x01, 0x01, 0x64});
        Assert.assertFalse(exitResp.buttonPresent);
        Assert.assertEquals(Button.Unknown, exitResp.button);

        MusicControl.Control.Response volResp = parseControl(new byte[] {0x02, 0x01, 0x42});
        Assert.assertFalse(volResp.buttonPresent);
        Assert.assertTrue(volResp.volumePresent);
        Assert.assertEquals(0x42, volResp.volume);

        MusicControl.Control.Response combinedResp = parseControl(new byte[] {0x01, 0x01, 0x01, 0x02, 0x01, 0x42});
        Assert.assertTrue(combinedResp.buttonPresent);
        Assert.assertEquals(Button.Play, combinedResp.button);
        Assert.assertTrue(combinedResp.volumePresent);
        Assert.assertEquals(0x42, combinedResp.volume);

        MusicControl.Control.Response emptyTagsResp = parseControl(new byte[] {0x01, 0x00, 0x02, 0x00});
        Assert.assertFalse(emptyTagsResp.buttonPresent);
        Assert.assertFalse(emptyTagsResp.volumePresent);
    }
}

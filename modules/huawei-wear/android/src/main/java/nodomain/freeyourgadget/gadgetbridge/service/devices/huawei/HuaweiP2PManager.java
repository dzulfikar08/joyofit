/*  Copyright (C) 2024-2025 Me7c7

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
    along with this program.  If not, see <https://www.gnu.org/licenses/>. */
// Modified for watch-fit (AGPL-3.0-or-later): HuaweiSupportProvider is replaced by the small Transport interface (the session layer
// implements it); the wake-app screenshot route (HuaweiP2PWakeAppScreenshot, android.net.Uri) is not ported, so every wake-app link is
// answered with GB's "not supported" code 0xd2; packets and files are routed by the same source package GB uses; unregisterService(module)
// removes one service (JoyoFit's watch navigation registers only while a session runs).
package nodomain.freeyourgadget.gadgetbridge.service.devices.huawei;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.P2P;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiBaseP2PService;
import nodomain.freeyourgadget.gadgetbridge.util.GB;

public class HuaweiP2PManager {
    private final Logger LOG = LoggerFactory.getLogger(HuaweiP2PManager.class);

    /** What GB takes from HuaweiSupportProvider / HuaweiState / SendP2PCommand, as a seam for the session layer. */
    public interface Transport {
        /** GB SendP2PCommand.doPerform: one 0x34/0x01 packet, not waiting for an answer. */
        void sendP2P(byte cmdId, short sequence, String srcPackage, String dstPackage,
                     String srcFingerprint, String dstFingerprint, byte[] sendData, int sendCode) throws IOException;

        /** GB HuaweiState.supportsExpandCapability(int). */
        boolean supportsExpandCapability(int which);

        /** Protocol log line (events.log in the app, so adb logcat -s JoyoFit shows it). */
        void log(String message);
    }

    private final Transport transport;

    private final List<HuaweiBaseP2PService> registeredServices;

    private short sequence = 1;

    public synchronized short getNextSequence() {
        sequence = (short) ((sequence + 1) % (Short.MAX_VALUE - 1));
        return sequence;
    }

    public HuaweiP2PManager(Transport transport) {
        this.transport = transport;
        this.registeredServices = new ArrayList<>();
    }

    public Transport getTransport() {
        return transport;
    }

    public synchronized void registerService(HuaweiBaseP2PService service) {
        for (HuaweiBaseP2PService svr : new ArrayList<>(registeredServices)) {
            if (svr.getModule().equals(service.getModule())) {
                LOG.error("P2P Service already registered, unregister: {}", service.getModule());
                svr.unregister();
                registeredServices.remove(svr);
            }
        }
        registeredServices.add(service);
        service.registered();
    }

    public synchronized HuaweiBaseP2PService getRegisteredService(String module) {
        for (HuaweiBaseP2PService svr : registeredServices) {
            if (svr.getModule().equals(module)) {
                return svr;
            }
        }
        return null;
    }

    public synchronized void unregisterAllService() {
        for (HuaweiBaseP2PService svr : registeredServices) {
            svr.unregister();
        }
        registeredServices.clear();
    }

    public synchronized void unregisterService(String module) {
        for (HuaweiBaseP2PService svr : new ArrayList<>(registeredServices)) {
            if (svr.getModule().equals(module)) {
                svr.unregister();
                registeredServices.remove(svr);
            }
        }
    }

    private synchronized List<HuaweiBaseP2PService> snapshot() {
        return new ArrayList<>(registeredServices);
    }

    public void sendAck(short sequence, String srcPackage, String dstPackage, int code) {
        try {
            transport.sendP2P((byte) 3, sequence, srcPackage, dstPackage, null, null, null, code);
        } catch (IOException e) {
            LOG.error("P2P Service error send ACK", e);
        }
    }

    public int handleLink(String link) {
        // GB answers the links it has a handler for with 0xd1; none of those handlers is ported.
        return 0xd2;
    }

    public int handleWakeApp(P2P.P2PCommand.Response packet) {
        if (packet.respData == null || packet.respData.length == 0) {
            return 0xcc;
        }

        HuaweiTLV tlv = new HuaweiTLV();
        tlv.parse(packet.respData);
        String link = "";
        if (tlv.contains(0x04)) {
            try {
                link = tlv.getString(0x04);
            } catch (HuaweiPacket.MissingTagException e) {
                LOG.error("P2P Service error get link", e);
            }
        }

        if (!link.isEmpty()) {
            return handleLink(link);
        }
        // TODO (GB): support other TLV.
        return 0xcd;
    }

    public void handleFile(String srcPackage, String dstPackage, String srcFingerprint, String dstFingerprint, String filename, byte[] data) {
        // NOTE (GB): Maybe packet should be found by dstPacket or as a pair package + fingerprint
        for (HuaweiBaseP2PService service : snapshot()) {
            if (service.getPackage().equals(srcPackage)) {
                service.handleFile(filename, data);
            }
        }
    }

    public void handlePacket(P2P.P2PCommand.Response packet) {
        LOG.info("P2P Service message: Src: {} Dst: {} Seq: {}", packet.srcPackage, packet.dstPackage, packet.sequenceId);
        transport.log("P2P rx cmd=" + packet.cmdId + " src=" + packet.srcPackage + " dst=" + packet.dstPackage + " seq=" + packet.sequenceId
                + " code=" + packet.respCode + " data=" + (packet.respData == null ? "none" : packet.respData.length + " bytes"));
        LOG.debug("P2P Service message: cmd: {} code: {} data: {}",
                packet.cmdId, packet.respCode,
                packet.respData == null ? "null" : GB.hexdump(packet.respData));
        if (packet.cmdId == 1) {
            String[] split = packet.dstPackage.split("\\.");
            if (split.length > 2 && split[2].equals("wakeapp")) {
                int code = handleWakeApp(packet);
                sendAck(packet.sequenceId, packet.dstPackage, packet.srcPackage, code);
                return;
            }
        }
        for (HuaweiBaseP2PService service : snapshot()) {
            if (service.getPackage().equals(packet.srcPackage)) {
                service.handlePacket(packet);
            }
        }
    }
}

/*  Copyright (C) 2024 Damien Gaignon, José Rebelo, Martin.JM

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
package nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets;

import androidx.annotation.NonNull;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.List;
import java.util.TreeMap;

import org.json.JSONException;
import org.json.JSONObject;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCrypto;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiUtil;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCoordinator.HuaweiDeviceType;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV.TLV;
import nodomain.freeyourgadget.gadgetbridge.util.GB;
import nodomain.freeyourgadget.gadgetbridge.util.StringUtils;

// TODO: complete responses

public class DeviceConfig {
    public static final byte id = 0x01;

    public static class LinkParams {
        public static final byte id = 0x01;

        public static class Request extends HuaweiPacket {
            public Request(ParamsProvider paramsProvider, HuaweiDeviceType deviceType) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
                this.tlv = new HuaweiTLV()
                        .put(0x01)
                        .put(0x02)
                        .put(0x03)
                        .put(0x04);
                if (deviceType == HuaweiDeviceType.AW) {
                    this.tlv.put(0x06);
                }
                this.complete = true;
                this.isEncrypted = false;
                this.isSliced = false;
            }
        }

        public static class Response extends HuaweiPacket {
            public byte protocolVersion = 0x00;
            public short mtu = 0x0014;
            public short sliceSize = 0x00f4;
            public byte authVersion = 0x00;
            public byte[] serverNonce = new byte[16];
            public byte deviceSupportType = 0x00;
            public byte authAlgo = 0x00;
            public byte bondState = 0x00;
            public short interval = 0x0;
            public byte encryptMethod = 0x00;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
                this.isEncrypted = false;
            }

            @Override
            public void parseTlv() throws ParseException {
                if (this.tlv.contains(0x01))
                    this.protocolVersion = this.tlv.getByte(0x01);

                if (this.tlv.contains(0x02))
                    this.sliceSize = this.tlv.getShort(0x02);

                if (this.tlv.contains(0x03))
                    this.mtu = this.tlv.getShort(0x03);

                if (this.tlv.contains(0x04))
                    this.interval = this.tlv.getShort(0x04);

                System.arraycopy(this.tlv.getBytes(0x05), 2, this.serverNonce, 0, 16);
                this.authVersion = this.tlv.getBytes(0x05)[1];

                if (this.tlv.contains(0x07))
                    this.deviceSupportType = this.tlv.getByte(0x07);

                if (this.tlv.contains(0x08))
                    this.authAlgo = this.tlv.getByte(0x08);

                if (this.tlv.contains(0x09))
                    this.bondState = this.tlv.getByte(0x09);

                if (this.tlv.contains(0x0C))
                    this.encryptMethod = this.tlv.getByte(0x0C);
            }
        }
    }

    public static class SupportedServices {
        public static final byte id = 0x02;

        // device should always support service 0x01
	    // notDeviceCapabilities = 0x1C, 0x1E, 0x1F, 0x28, 0x29, 0x2C, 0x2F, 0x31
        // but services = 0x1E, 0x28, 0x2C, 0x31
        // service 0x21 depends on MiddleWear support

        public static final byte[] knownSupportedServices = new byte[] {
                0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A,
                0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x14,
                0x15, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B, 0x1D, 0x20,
                0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2A, 0x2B, 0x2D, 0x2E,
                0x30, 0x32, 0x33, 0x34, 0x35
        };

        public static class Request extends HuaweiPacket {
            public Request(ParamsProvider paramsProvider, byte[] allSupportedServices) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
                this.tlv = new HuaweiTLV()
                        .put(0x01, allSupportedServices);
                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {
            public byte[] supportedServices;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
            }

            @Override
            public void parseTlv() throws ParseException {
                this.supportedServices = this.tlv.getBytes(0x02);
            }
        }

        public static class OutgoingRequest extends HuaweiPacket {
            public byte[] allSupportedServices = null;

            public OutgoingRequest(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.complete = false;
            }

            @Override
            public List<byte[]> serialize() throws CryptoException {
                return null;
            }

            @Override
            public void parseTlv() throws ParseException {
                this.allSupportedServices = this.tlv.getBytes(0x01);
            }
        }
    }

    public static class SupportedCommands {
        public static final byte id = 0x03;

        public static final TreeMap<Integer, byte[]> commandsPerService = new TreeMap<>() {{
            put(0x01, new byte[] {0x04, 0x07, 0x08, 0x09, 0x0A, 0x0D, 0x0E, 0x10, 0x11, 0x12, 0x13, 0x14, 0x1B, 0x1A, 0x1D, 0x21, 0x22, 0x23, 0x24, 0x29, 0x2A, 0x2B, 0x32, 0x2E, 0x31, 0x30, 0x35, 0x36, 0x37, 0x2F});
            put(0x02, new byte[] {0x01, 0x04, 0x05, 0x06, 0x07, 0x08});
            put(0x03, new byte[] {0x01, 0x03, 0x04});
            put(0x04, new byte[] {0x01});
            put(0x05, new byte[] {0x01});
            put(0x06, new byte[] {0x01});
            put(0x07, new byte[] {0x01, 0x03, 0x05, 0x07, 0x08, 0x09, 0x0A, 0x0E, 0x10, 0x13, 0x16, 0x15, 0x17, 0x18, 0x1B, 0x1C, 0x1D, 0x1E, 0x21, 0x22, 0x23, 0x24, 0x25, 0x28, 0x29, 0x06, 0x1F});
            put(0x08, new byte[] {0x01, 0x02, 0x03});
            put(0x09, new byte[] {0x01, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F});
            put(0x0A, new byte[] {0x01, 0x09, 0x0A});
            put(0x0B, new byte[] {0x01, 0x03});
            put(0x0C, new byte[] {0x01});
            put(0x0D, new byte[] {0x01});
            put(0x0F, new byte[] {0x01, 0x03, 0x05, 0x06, 0x07, 0x08, 0x0A, 0x0B, 0x0C});
            put(0x10, new byte[] {0x01});
            put(0x11, new byte[] {0x01});
            put(0x12, new byte[] {0x01});
            put(0x13, new byte[] {0x01});
            put(0x14, new byte[] {0x01});
            put(0x15, new byte[] {0x01});
            put(0x16, new byte[] {0x01, 0x03, 0x07});
            put(0x17, new byte[] {0x01, 0x04, 0x06, 0x07, 0x0B, 0x0C, 0x10, 0x12, 0x15, 0x17});
            put(0x18, new byte[] {0x01, 0x02, 0x04, 0x05, 0x06, 0x09});
            put(0x19, new byte[] {0x01, 0x04});
            put(0x1A, new byte[] {0x01, 0x03, 0x07, 0x05, 0x06});
            put(0x1B, new byte[] {0x01, 0x0F, 0x19, 0x1A});
            // No 0x1C
            put(0x1D, new byte[] {0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A});
            // No 0x1E
            // No 0x1F
            put(0x20, new byte[] {0x01, 0x02, 0x03, 0x04, 0x09, 0x0A});
            //put(0x21, new byte[] {0x01});
            put(0x22, new byte[] {0x01});
            put(0x23, new byte[] {0x02, 0x0B});
            put(0x24, new byte[] {0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C});
            put(0x25, new byte[] {0x02, 0x04, 0x0E});
            put(0x26, new byte[] {0x02, 0x03});
            put(0x27, new byte[] {0x01, 0x0E});
            // No 0x28
            // No 0x29
            put(0x2A, new byte[] {0x01, 0x06});
            put(0x2B, new byte[] {0x12});
            // No 0x2C
            put(0x2D, new byte[] {0x01});
            put(0x2E, new byte[] {0x01, 0x02, 0x03});
            // No 0x2F
            put(0x30, new byte[] {0x01});
            // No 0x31
            put(0x32, new byte[] {0x01});
            put(0x33, new byte[] {0x01, 0x2});
            put(0x34, new byte[] {0x01});
            put(0x35, new byte[] {0x03, 0x04});
        }};


        public static class Request extends HuaweiPacket {
            private int maxSize;

            public Request(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
                this.tlv = new HuaweiTLV();

                // slice size is the max size
                // But there is a 4 byte header,
                // a two byte body header,
                // a two byte footer,
                // three bytes get added for the 0x81 tag,
                // and 21 for the encryption stuff
                this.maxSize = this.paramsProvider.getSliceSize() - 32;
                // Now it gets aligned to 16 byte blocks
                // And it gets a header and two length bytes
                // For CBC there is also at least one byte padding
                this.maxSize = this.maxSize - (this.maxSize % 16) - 4;
            }

            public boolean addCommandsForService(byte service, byte[] commands) {
                // tlv length is what we have already
                // commands is what we'll add
                // together with a 3-byte 0x02 tag and two bytes for length
                if (this.tlv.length() + commands.length + 5 > this.maxSize) { //this.paramsProvider.mtu - 5 - 2 - 2 - 2 - 21) {
                    return false;
                }
                this.tlv.put(0x02, service).put(0x03, commands);
                return true;
            }

            @Override
            public List<byte[]> serialize() throws CryptoException {
                this.tlv = new HuaweiTLV()
                        .put(0x81, this.tlv);
                this.complete = true;
                return super.serialize();
            }
        }

        public static class Response extends HuaweiPacket {
            public static class CommandsList {
                public int service;
                public byte[] commands;

                @NonNull
                @Override
                public String toString() {
                    StringBuilder sb = new StringBuilder();
                    sb.append("CommandsList{service=");
                    sb.append(Integer.toHexString(service));
                    sb.append(", commands=[");
                    for (byte b : commands) {
                        sb.append(Integer.toHexString(b));
                        if (b != commands[commands.length - 1]) // Elements should be unique
                            sb.append(", ");
                    }
                    sb.append("]}");
                    return sb.toString();
                }
            }

            public List<CommandsList> commandsLists;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
                this.isEncrypted = false;
            }

            @Override
            public void parseTlv() throws ParseException {
                this.commandsLists = new ArrayList<>();
                CommandsList commandsList = null;
                HuaweiTLV containerTLV = this.tlv.getObject(0x81);

                for (HuaweiTLV.TLV tlv : containerTLV.get()) {
                    if ((int) tlv.getTag() == 0x02) {
                        commandsList = new CommandsList();
                        commandsList.service = ByteBuffer.wrap(tlv.getValue()).get();
                    } else if ((int) tlv.getTag() == 0x04) {
                        if (commandsList == null)
                            throw new SupportedCommandsListException("Commandslist is not yet set");
                        ByteBuffer buffer = ByteBuffer.allocate(tlv.getValue().length);
                        for (int i = 0; i < tlv.getValue().length; i++) {
                            if ((int) tlv.getValue()[i] == 1)
                                buffer.put((byte) (commandsPerService.get(commandsList.service)[i]));
                        }
                        commandsList.commands = new byte[buffer.position()];
                        ((ByteBuffer) buffer.rewind()).get(commandsList.commands);
                        this.commandsLists.add(commandsList);
                    } else
                        throw new SupportedCommandsListException("Unknown tag encountered");
                }
                if (this.commandsLists.isEmpty())
                    throw new SupportedCommandsListException("CommandLists is empty");
            }
        }

        // TODO: LogRequest
    }

    public static class DateFormat {
        public static final byte id = 0x04;

        public static class Request extends HuaweiPacket {
            public Request(
                    ParamsProvider paramsProvider,
                    byte dateFormat,
                    byte timeFormat
            ) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
                this.tlv = new HuaweiTLV()
                        .put(0x81, new HuaweiTLV()
                                .put(0x02, dateFormat)
                                .put(0x03, timeFormat)
                        );
                this.complete = true;
            }
        }

        public static class OutgoingRequest extends HuaweiPacket {
            public byte dateFormat;
            public byte timeFormat;

            public OutgoingRequest(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.complete = false;
            }

            @Override
            public void parseTlv() throws ParseException {
                if (this.tlv.contains(0x02))
                    this.dateFormat = this.tlv.getByte(0x02);

                if (this.tlv.contains(0x03))
                    this.timeFormat = this.tlv.getByte(0x03);
            }
        }
    }

    public static class TimeRequest extends HuaweiPacket {
        public static final byte id = 0x05;

        public TimeRequest(ParamsProvider paramsProvider, final Calendar now) {
            super(paramsProvider);
            this.serviceId = DeviceConfig.id;
            this.commandId = id;
            ByteBuffer timeAndZoneId = ByteBuffer.wrap(HuaweiUtil.getTimeAndZoneId(now));
            this.tlv = new HuaweiTLV()
                    .put(0x01, timeAndZoneId.getInt(0))
                    .put(0x02, timeAndZoneId.getShort(4));
            this.complete = true;
        }

        public TimeRequest(ParamsProvider paramsProvider) {
            this(paramsProvider, Calendar.getInstance());
        }

        public static class Response extends HuaweiPacket {
            public int deviceTime=0;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
            }

            @Override
            public void parseTlv() throws ParseException {
                if (this.tlv.contains(0x01)) {
                    this.deviceTime = this.tlv.getInteger(0x01);
                }
            }
        }

        // TODO: implement parsing this request for the log parser support
    }

    public static class ProductInfo {
        public static final byte id = 0x07;

        public static class Request extends HuaweiPacket {

            public Request(ParamsProvider paramsProvider, HuaweiDeviceType deviceType) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
                this.tlv = new HuaweiTLV();
                if (deviceType == HuaweiDeviceType.AW) {
                    int[] tags = {0x01, 0x02, 0x03, 0x07, 0x09, 0x0A, 0x0c, 0x11};
                    for (int i: tags) {
                        this.tlv.put(i);
                    }
                } else {
                    int[] tags = {0x01, 0x02, 0x07, 0x09, 0x0A, 0x11, 0x12, 0x16, 0x1A, 0x1D, 0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23};
                    for (int i : tags) {
                        this.tlv.put(i);
                    }
                } // else if (AW Compatible)
                //  this.tlv).put(0x01).put(0x02).put(0x07).put(0x09);
                // }
                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {
            // TODO: extend:
            //        public static final int BTVersion = 0x01;
            //        public static final int productType = 0x02;
            //        public static final int phoneNumber = 0x04;
            //        public static final int macAddress = 0x05;
            //        public static final int IMEI = 0x06;
            //        public static final int openSourceVersion = 0x08;
            //        public static final int serialNumber = 0x09;
            //        public static final int eMMCId = 0x0B;
            //        public static final int healthAppSupport = 0x0D;

            public String hardwareVersion;
            public String softwareVersion;
            public String serialNumber;
            public String productModel;
            public String packageName;
            public String deviceName;
            public int regionCode;
            public int otaSignatureLength = 256;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
                this.isEncrypted = false;
            }

            @Override
            public void parseTlv() throws ParseException {
                if (this.tlv.contains(0x03))
                    this.hardwareVersion = this.tlv.getString(0x03);
                this.softwareVersion = this.tlv.getString(0x07);

                if(this.tlv.contains(0x09))
                    this.serialNumber = this.tlv.getString(0x09);

                this.productModel = this.tlv.getString(0x0A).trim();

                if(this.tlv.contains(0x0F))
                    this.packageName = this.tlv.getString(0x0F);

                if(this.tlv.contains(0x11))
                    this.deviceName = this.tlv.getString(0x11);

                if(this.tlv.contains(0x14))
                    this.regionCode = this.tlv.getAsInteger(0x14);

                if(this.tlv.contains(0x27))
                    this.otaSignatureLength = this.tlv.getAsInteger(0x27);
            }
        }

        // TODO: implement parsing this request for the log parser support
    }

    public static class Bond {
        public static final byte id = 0x0E;

        public static class Request extends HuaweiPacket {
            public Request(
                    ParamsProvider paramsProvider,
                    byte[] clientSerial,
                    byte[] key,
                    byte[] iv
            ) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                        .put(0x01)
                        .put(0x03, (byte) 0x00)
                        .put(0x05, clientSerial)
                        .put(0x06, key)
                        .put(0x07, iv);
                this.isEncrypted = false;
                this.complete = true;
            }
        }

        public static class OutgoingRequest extends HuaweiPacket {
            public byte[] clientSerial;
            public byte[] bondingKey;
            public byte[] iv;

            public OutgoingRequest(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.complete = false;
            }

            @Override
            public void parseTlv() throws ParseException {
                this.clientSerial = this.tlv.getBytes(0x05);
                this.bondingKey = this.tlv.getBytes(0x06);
                this.iv = this.tlv.getBytes(0x07);
            }
        }
    }

    public static class BondParams {
        public static final byte id = 0x0F;

        public static class Request extends HuaweiPacket {
            public Request(
                    ParamsProvider paramsProvider,
                    byte[] clientSerial,
                    byte[] mac
            ) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                        .put(0x01)
                        .put(0x03, clientSerial)
                        .put(0x04, (byte) 0x02)
                        .put(0x05)
                        .put(0x07, mac)
                        .put(0x09);
                this.isEncrypted = false;
                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {
            public byte status;
            public long encryptionCounter;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.isEncrypted = false;
            }

            @Override
            public void parseTlv() throws ParseException {
                this.status = this.tlv.getByte(0x01);
                this.encryptionCounter = this.tlv.getInteger(0x09) & 0xFFFFFFFFL;
            }
        }
        // TODO: implement parsing this request for the log parser support
    }

    public static class ActivityType {
        public static final int id = 0x12;

        public static class Request extends HuaweiPacket {
            public Request(ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                    .put(0x01);

                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {
            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
            }

            @Override
            public void parseTlv() throws ParseException {
            }
        }

    }

    public static class Auth {
        public static final byte id = 0x13;

        public static class Request extends HuaweiPacket {
            public Request(
                    ParamsProvider paramsProvider,
                    byte[] challenge,
                    byte[] nonce
            ) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                        .put(0x01, challenge)
                        .put(0x02, nonce);
                if (paramsProvider.getAuthMode() == 0x02)
                    this.tlv.put(0x03, paramsProvider.getAuthAlgo());
                this.isEncrypted = false;
                this.complete = true;
            }

        }

        public static class OutgoingRequest extends HuaweiPacket {
            public byte[] challenge;
            public byte[] nonce;

            public OutgoingRequest(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.complete = false;
            }

            @Override
            public void parseTlv() throws ParseException {
                this.challenge = this.tlv.getBytes(0x01);
                this.nonce = this.tlv.getBytes(0x02);
            }
        }

        public static class Response extends HuaweiPacket {
            public byte[] challengeResponse;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.isEncrypted = false;
            }

            @Override
            public void parseTlv() throws ParseException {
                this.challengeResponse = this.tlv.getBytes(0x01);
            }
        }
        // TODO: implement parsing this request for the log parser support
    }

    public static class BatteryLevel {
        public static final byte id = 0x08;
        public static final byte id_change = 0x27; // Same format, async (receive) only

        public static class Request extends HuaweiPacket {
            public Request(ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                        .put(0x01);
                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {
            public byte level;

            public byte[] multi_level;
            public byte[] status; // TODO: enum

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);

                // This differs per watch, so we handle it ourselves in parseTlv
                this.isEncrypted = false;
            }

            @Override
            public void parseTlv() throws ParseException {
                this.level = this.tlv.getByte(0x01);
                this.multi_level = this.tlv.getBytes(0x02, null);
                this.status = this.tlv.getBytes(0x03, null);
            }
        }
        // TODO: implement parsing this request for the log parser support
    }

    public static class ActivateOnLiftRequest extends HuaweiPacket {
        public static final byte id = 0x09;

        public ActivateOnLiftRequest(ParamsProvider paramsProvider, boolean activate) {
            super(paramsProvider);

            this.serviceId = DeviceConfig.id;
            this.commandId = id;

            this.tlv = new HuaweiTLV()
                    .put(0x01, activate);

            this.complete = true;
        }
        // TODO: implement parsing this request for the log parser support
    }

    public static class DndDeleteRequest extends HuaweiPacket {
        public static final int id = 0x0B;

        public DndDeleteRequest(HuaweiPacket.ParamsProvider paramsProvider) {
            super(paramsProvider);

            this.serviceId = DeviceConfig.id;
            this.commandId = id;

            this.tlv = new HuaweiTLV()
                .put(0x81, new HuaweiTLV()
                    .put(0x02, (byte) 0x01)
                );
            this.complete = true;
        }
        // TODO: implement parsing this request for the log parser support
    }

    public static class DndAddRequest extends HuaweiPacket {
        public static final int id = 0x0C;

        public DndAddRequest(
            HuaweiPacket.ParamsProvider paramsProvider,
            boolean dndEnable,
            byte[] start,
            byte[] end,
            int cycle,
            int dndLiftWristType,
            boolean allowDndLiftWrist
        ) {
            super(paramsProvider);

            this.serviceId = DeviceConfig.id;
            this.commandId = id;

            HuaweiTLV dndPacket = new HuaweiTLV()
                    .put(0x02, (byte) 0x01)
                    .put(0x03, dndEnable)
                    .put(0x04, (byte) 0x00)
                    .put(0x05, start)
                    .put(0x06, end)
                    .put(0x07, (byte) cycle);

            if (allowDndLiftWrist) {
                dndPacket.put(0x08, (short) (dndLiftWristType));
            }
            this.tlv = new HuaweiTLV()
                    .put(0x81, dndPacket);
            this.complete = true;
        }
        // TODO: implement parsing this request for the log parser support
    }

    public static class FactoryResetRequest extends HuaweiPacket {
        public static final byte id = 0x0D;

        public FactoryResetRequest(HuaweiPacket.ParamsProvider paramsProvider) {
            super(paramsProvider);

            this.serviceId = DeviceConfig.id;
            this.commandId = id;

            this.tlv = new HuaweiTLV()
                    .put(0x01, (byte) 0x01);

            this.complete = true;
        }
        // TODO: implement parsing this request for the log parser support
    }

    public static class PhoneInfo {
        public static final byte id = 0x10;

        public static class Request extends HuaweiPacket {
            public Request(HuaweiPacket.ParamsProvider paramsProvider, byte[] phoneInfo) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV();
                for (byte b : phoneInfo) {
                    switch (b) {
                        case 0x0:
                            break;
                        case 0x2:
                            this.tlv.put(b); // Force phone manufactures to ""
                            break;
                        case 0x4:
                            this.tlv.put(b); // Force phone model to ""
                            break;
                        case 0x8:
                            this.tlv.put(b, "14"); // Force android version to "14"
                            break;
                        case 0xf:
                            break;
                        case 0x11:
                            this.tlv.put(b, 1600103320); // Force AppVersion to 16.1.3.320
                            break;
                        case 0x15:
                            this.tlv.put(b); // Force buildOSPlatformVersion to ""
                            break;
                        case 0x10: // Force EmuiBuildVersion to 0x00
                        case 0x13: // Force buildOsEnable to 0x00
                        case 0x14: // Force buildOSApiVersion to 0x00
                        case 0x16: // Force phoneCapability to 0x00
                        default:
                            this.tlv.put(b, (byte)0);
                    }
                }
                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {
            public boolean isAck = false;
            public byte[] info;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;
            }

            @Override
            public void parseTlv() throws MissingTagException {
                if (this.tlv.get().size() == 1 && this.tlv.contains(0x7f) && this.tlv.getInteger(0x7f) == 0x186A0) {
                    this.isAck = true;
                    return;
                }

                info = new byte[this.tlv.length()];
                int i = 0;
                for (TLV tlv : this.tlv.get()) {
                    info[i] = tlv.getTag();
                    i += 1;
                }
            }
        }

        // TODO: implement parsing this request for the log parser support
    }

    public static class DeviceStatus {
        public static final byte id = 0x16;

        public static class Request extends HuaweiPacket {
            public Request(HuaweiPacket.ParamsProvider paramsProvider, boolean askStatus) { // status or notify
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV();
                if (askStatus) {
                    this.tlv.put(0x01);
                } else {
                    this.tlv.put(0x02, (byte)0x00);
                }
                this.isEncrypted = false;
                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {
            public byte status = -1;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.isEncrypted = false;
            }

            @Override
            public void parseTlv() throws ParseException {
                // AW70 doesn't seem to have this
                if (this.tlv.contains(0x01))
                    this.status = this.tlv.getByte(0x01);
            }
        }

        // TODO: implement parsing this request for the log parser support
    }

    public static class NavigateOnRotateRequest extends HuaweiPacket {
        public static final byte id = 0x1B;

        public NavigateOnRotateRequest(HuaweiPacket.ParamsProvider paramsProvider, boolean navigate) {
            super(paramsProvider);

            this.serviceId = DeviceConfig.id;
            this.commandId = id;

            this.tlv = new HuaweiTLV()
                    .put(0x01, navigate);

            this.complete = true;
        }
        // TODO: implement parsing this request for the log parser support
    }

    public static class WearLocationRequest extends HuaweiPacket {
        public static final byte id = 0x1A;

        public WearLocationRequest(HuaweiPacket.ParamsProvider paramsProvider, byte location) {
            super(paramsProvider);

            this.serviceId = DeviceConfig.id;
            this.commandId = id;

            this.tlv = new HuaweiTLV()
                    .put(0x01, location);

            this.complete = true;
        }
        // TODO: implement parsing this request for the log parser support
    }

    public static class DndLiftWristType {
        public static final int id = 0x1D;

        public static class Request extends HuaweiPacket {
            public Request(HuaweiPacket.ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                    .put(0x01);
                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {
            public int dndLiftWristType;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
            }

            @Override
            public void parseTlv() throws ParseException {
                this.dndLiftWristType = (int) this.tlv.getShort(0x01);
            }
        }
        // TODO: implement parsing this request for the log parser support
    }

    // TODO: set (earphone) double tap action 0x1f
    // TODO: get (earphone) double tap action 0x20

    public static class GetDefaultSwitch {
        public static final int id = 0x21;

        public static class Request extends HuaweiPacket {
            public Request(HuaweiPacket.ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                        .put(0x01);
                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
            }

            @Override
            public void parseTlv() throws ParseException {

            }
        }
    }

    public static class HiChain {
        public static final int id = 0x28;

        public static class Request {
            private final int operationCode;
            private final long requestId;
            private final byte[] selfAuthId;
            private final String groupId;
            private JSONObject version = null;
            private JSONObject jsonPayload = null;
            private JSONObject value = null;

            public Request (int operationCode, long requestId, byte[] selfAuthId, String groupId) {
                this.operationCode = operationCode;
                this.requestId = requestId;
                this.selfAuthId = selfAuthId;
                this.groupId = groupId;
            }

            public class BaseStep extends HuaweiPacket {
                public BaseStep (HuaweiPacket.ParamsProvider paramsProvider, int messageId) throws SerializeException {
                    super(paramsProvider);
                    this.serviceId = DeviceConfig.id;
                    this.commandId = HiChain.id;
                    this.isSliced = true;
                    this.isEncrypted = false;
                    this.complete = true;
                    version = new JSONObject();
                    jsonPayload = new JSONObject();
                    value = new JSONObject();
                    createJson(messageId);
                }
            }

            public class StepOne extends BaseStep {

                public StepOne (
                    HuaweiPacket.ParamsProvider paramsProvider,
                    int messageId,
                    byte[] isoSalt,
                    byte[] seed
                ) throws SerializeException {
                    super(paramsProvider, messageId);
                    // createJson(1); //messageId);
                    try {
                        jsonPayload
                            .put("isoSalt", StringUtils.bytesToHex(isoSalt))
                            .put("peerAuthId",  StringUtils.bytesToHex(selfAuthId))
                            .put("operationCode", operationCode)
                            .put("seed", StringUtils.bytesToHex(seed))
                            .put("peerUserType", 0x00);
                        if (operationCode == 0x02) {
                            jsonPayload
                                .put("pkgName", "com.huawei.devicegroupmanage")
                                .put("serviceType", groupId)
                                .put("keyLength", 0x20);
                            value.put("isDeviceLevel", false);
                        }
                        this.tlv = new HuaweiTLV()
                            .put(0x01, value.toString())
                            .put(0x02, (byte)operationCode)
                            .put(0x03, ByteBuffer.allocate(8).putLong(requestId).array());
                            //.put(0x04, 0x00)
                            //.put(0x05, 0x00);
                    } catch (JSONException e) {
                        throw new SerializeException("HiChain Step1 JSON exception", e);
                    }
                }
            }

            public class StepTwo extends BaseStep {
                public StepTwo (
                    HuaweiPacket.ParamsProvider paramsProvider,
                    int messageId,
                    byte[] token
                ) throws SerializeException {
                    super(paramsProvider, messageId);
                    // createJson(2); //messageId);
                    try {
                        jsonPayload
                            .put("peerAuthId", StringUtils.bytesToHex(selfAuthId))
                            .put("token", StringUtils.bytesToHex(token));
                        if (operationCode == 0x02) value.put("isDeviceLevel", false);
                        this.tlv = new HuaweiTLV()
                            .put(0x01, value.toString())
                            .put(0x02, (byte)operationCode)
                            .put(0x03, ByteBuffer.allocate(8).putLong(requestId).array());
                    } catch (JSONException e) {
                        throw new SerializeException("HiChain Step 2 JSON exception", e);
                    }
                }
            }

            public class StepThree extends BaseStep {
                public StepThree (
                    HuaweiPacket.ParamsProvider paramsProvider,
                    int messageId,
                    byte[] nonce,
                    byte[] encData
                ) throws SerializeException {
                    super(paramsProvider, messageId);
                    // createJson(3);
                    try {
                        jsonPayload
                            .put("nonce", StringUtils.bytesToHex(nonce))
                            .put("encData", StringUtils.bytesToHex(encData));
                        this.tlv = new HuaweiTLV()
                            .put(0x01, value.toString())
                            .put(0x02, (byte)operationCode)
                            .put(0x03, ByteBuffer.allocate(8).putLong(requestId).array());
                    } catch (JSONException e) {
                        throw new SerializeException("HiChain Step 3 JSON exception", e);
                    }
                }
            }

            public class StepFour extends BaseStep {
                public StepFour (
                    HuaweiPacket.ParamsProvider paramsProvider,
                    int messageId,
                    byte[] nonce,
                    byte[] encResult
                ) throws SerializeException {
                    super(paramsProvider, messageId);
                    // if (operationCode == 0x01) {
                    //     createJson(4); //messageId);
                    // } else {
                    //     createJson(3);
                    // }
                    try {
                        jsonPayload
                            .put("nonce", StringUtils.bytesToHex(nonce)) //generateRandom
                            .put("encResult", StringUtils.bytesToHex(encResult))
                            .put("operationCode", operationCode);
                        this.tlv = new HuaweiTLV()
                            .put(0x01, value.toString())
                            .put(0x02, (byte)operationCode)
                            .put(0x03, ByteBuffer.allocate(8).putLong(requestId).array());
                    } catch (JSONException e) {
                        throw new SerializeException("HiChain Step 4 JSON exception", e);
                    }
                }
            }

            private void createJson(int messageId) throws HuaweiPacket.SerializeException {
                if (operationCode == 0x02) {
                    messageId |= 0x10;
                }
                try {
                    version
                        .put("minVersion", "1.0.0")
                        .put("currentVersion", "2.0.16");
                    jsonPayload
                        .put("version", version);
                    value
                        .put("authForm", 0x00)
                        .put("payload", jsonPayload)
                        .put("groupAndModuleVersion", "2.0.1")
                        .put("message", messageId);
                    if (operationCode == 0x01) {
                        value
                            .put("requestId", Long.toString(requestId))
                            .put("groupId", groupId)
                            .put("groupName", "health_group_name")
                            .put("groupOp", 2)
                            .put("groupType", 256)
                            .put("peerDeviceId", new String(selfAuthId, StandardCharsets.UTF_8)) 
                            .put("connDeviceId", new String(selfAuthId, StandardCharsets.UTF_8))
                            .put("appId", "com.huawei.health")
                            .put("ownerName", "");
                    }
                } catch (JSONException e) {
                    throw new HuaweiPacket.SerializeException("Create json Exception", e);
                }
            }
        }

        public static class Response extends HuaweiPacket {
            // TODO: get rid of GB import...
            // TODO: add operation code

            public static class Step1Data {
                public byte[] isoSalt;
                public byte[] peerAuthId;
                public int peerUserType;
                public byte[] token;

                public Step1Data(JSONObject payload) throws JSONException {
                    this.isoSalt = GB.hexStringToByteArray(payload.getString("isoSalt"));
                    this.peerAuthId = GB.hexStringToByteArray(payload.getString("peerAuthId"));
                    this.peerUserType = payload.getInt("peerUserType");
                    this.token = GB.hexStringToByteArray(payload.getString("token"));
                }

                @NonNull
                @Override
                public String toString() {
                    return "Step1Data{" +
                            "isoSalt=" + StringUtils.bytesToHex(isoSalt) +
                            ", peerAuthId=" + StringUtils.bytesToHex(peerAuthId) +
                            ", peerUserType=" + peerUserType +
                            ", token=" + StringUtils.bytesToHex(token) +
                            '}';
                }
            }

            public static class Step2Data {
                public byte[] returnCodeMac;

                public Step2Data(JSONObject payload) throws JSONException {
                    this.returnCodeMac = GB.hexStringToByteArray(payload.getString("returnCodeMac"));
                }

                @NonNull
                @Override
                public String toString() {
                    return "Step2Data{" +
                            "returnCodeMac=" + StringUtils.bytesToHex(returnCodeMac) +
                            '}';
                }
            }

            public static class Step3Data {
                public byte[] nonce;
                public byte[] encAuthToken;

                public Step3Data(JSONObject payload) throws JSONException {
                    this.nonce = GB.hexStringToByteArray(payload.getString("nonce"));
                    this.encAuthToken = GB.hexStringToByteArray(payload.getString("encAuthToken"));
                }

                @NonNull
                @Override
                public String toString() {
                    return "Step3Data{" +
                            "nonce=" + StringUtils.bytesToHex(nonce) +
                            ", encAuthToken=" + StringUtils.bytesToHex(encAuthToken) +
                            '}';
                }
            }

            public static class Step4Data {
                public String data;

                public Step4Data(HuaweiTLV tlv) throws ParseException {
                    if (tlv.contains(0x01))
                        this.data = tlv.getString(0x01);
                }

                @NonNull
                @Override
                public String toString() {
                    return "Step4Data{" +
                            "data='" + data + '\'' +
                            '}';
                }
            }

            public static class PakeResponseData {
                public byte[] challenge;
                public byte[] salt;
                public byte[] epk;

                public PakeResponseData(JSONObject payload) throws JSONException {
                    this.challenge = GB.hexStringToByteArray(payload.getString("challenge"));
                    this.salt = GB.hexStringToByteArray(payload.getString("salt"));
                    this.epk = GB.hexStringToByteArray(payload.getString("epk"));
                }

                @NonNull
                @Override
                public String toString() {
                    return "PakeResponseData{" +
                            "challenge=" + StringUtils.bytesToHex(challenge) +
                            ", salt=" + StringUtils.bytesToHex(salt) +
                            ", epk=" + StringUtils.bytesToHex(epk) +
                            '}';
                }
            }

            public static class PakeConfirmData {
                public byte[] kcfData;

                public PakeConfirmData(JSONObject payload) throws JSONException {
                    this.kcfData = GB.hexStringToByteArray(payload.getString("kcfData"));
                }

                @NonNull
                @Override
                public String toString() {
                    return "PakeConfirmData{" +
                            "kcfData=" + StringUtils.bytesToHex(kcfData) +
                            '}';
                }
            }

            public static class PakeExchangeData {
                public byte[] exAuthInfo;

                public PakeExchangeData(JSONObject payload) throws JSONException {
                    this.exAuthInfo = GB.hexStringToByteArray(payload.getString("exAuthInfo"));
                }

                @NonNull
                @Override
                public String toString() {
                    return "PakeExchangeData{" +
                            "exAuthInfo=" + StringUtils.bytesToHex(exAuthInfo) +
                            '}';
                }
            }

            /**
             * Reconnect AUTH_START_RESPONSE (message 32785). This is PSK-SPEKE: the payload is a
             * PAKE response (challenge/salt/epk) plus the server {@code nonce} used to derive the
             * SPEKE PIN. There is no server signature. See GetHiChainPakeRequest STS handling.
             */
            public static class StsStartResponseData {
                public byte[] challenge;
                public byte[] epk;
                public byte[] salt;
                public byte[] nonce;
                public byte[] peerAuthId; // optional

                public StsStartResponseData(JSONObject payload) throws JSONException {
                    this.challenge = GB.hexStringToByteArray(payload.getString("challenge"));
                    this.epk = GB.hexStringToByteArray(payload.getString("epk"));
                    this.salt = GB.hexStringToByteArray(payload.getString("salt"));
                    this.nonce = GB.hexStringToByteArray(payload.getString("nonce"));
                    if (payload.has("peerAuthId"))
                        this.peerAuthId = GB.hexStringToByteArray(payload.getString("peerAuthId"));
                }

                @NonNull
                @Override
                public String toString() {
                    return "StsStartResponseData{challenge=" + StringUtils.bytesToHex(challenge)
                            + ", epk=" + StringUtils.bytesToHex(epk)
                            + ", salt=" + StringUtils.bytesToHex(salt)
                            + ", nonce=" + StringUtils.bytesToHex(nonce) + '}';
                }
            }

            /** Reconnect AUTH_ACK_RESPONSE (message 32786): the PAKE server-confirm proof. */
            public static class StsAckResponseData {
                public byte[] kcfData;

                public StsAckResponseData(JSONObject payload) throws JSONException {
                    this.kcfData = GB.hexStringToByteArray(payload.getString("kcfData"));
                }

                @NonNull
                @Override
                public String toString() {
                    return "StsAckResponseData{kcfData=" + StringUtils.bytesToHex(kcfData) + '}';
                }
            }

            public static class X25519KeyExchangeData {
                public byte opCode;
                public byte[] publicKey;

                public X25519KeyExchangeData(HuaweiTLV tlv) throws HuaweiPacket.MissingTagException {
                    this.opCode = tlv.getByte(0x01);
                    this.publicKey = tlv.getBytes(0x02);
                }

                @NonNull
                @Override
                public String toString() {
                    return "X25519KeyExchangeData{" +
                            "opCode=" + opCode +
                            ", publicKey=" + StringUtils.bytesToHex(publicKey) +
                            '}';
                }
            }

            // TODO: enum?
            // 0 is json?
            // 2 is raw string?
            public byte type;

            public JSONObject value;
            public JSONObject jsonPayload;

            public byte step;
            // public int operationCode; // TODO

            public Step1Data step1Data;
            public Step2Data step2Data;
            public Step3Data step3Data;
            public Step4Data step4Data;
            public PakeResponseData pakeResponseData;
            public PakeConfirmData pakeConfirmData;
            public PakeExchangeData pakeExchangeData;
            public StsStartResponseData stsStartData;
            public StsAckResponseData stsAckData;
            public X25519KeyExchangeData x25519KeyExchangeData;
            public int errorCode = 0;

            // STS reconnect step markers (kept distinct from the PAKE bind steps 0x00-0x04)
            public static final byte STEP_STS_START = 0x11; // parsed msg 32785
            public static final byte STEP_STS_ACK = 0x13;   // parsed msg 32786

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = HiChain.id;
                this.isEncrypted = false;
            }

            @Override
            public void parseTlv() throws ParseException {
                // Huawei HiChain framing carries an explicit type tag (0x04); the JSON
                // payload lives in tag 0x01. Kept for devices that still use it. This framing is
                // only produced by classic Huawei HiChain devices (i.e. !supportsHiChainPake),
                // so its JSON goes through the classic step router.
                if (this.tlv.contains(0x04)) {
                    this.type = this.tlv.getByte(0x04);
                    if (this.type == 0x00) {
                        parseHiChainJsonPayload(this.tlv.getString(0x01));
                    } else {
                        this.step = 0x04;
                        this.step4Data = new Step4Data(this.tlv);
                    }
                    return;
                }

                // Honor MBB HiChain framing (packHiChainData): tag 0x01 = dataType, tag 0x02 = payload.
                //   dataType 1 = X25519 pubkey exchange, 2 = PAKE JSON passthrough, 3 = device identity.
                // This framing is only produced by Honor PAKE devices (supportsHiChainPake), so its
                // JSON goes through the PAKE/STS step router.
                byte dataType = this.tlv.getByte(0x01);
                if (dataType == 0x01) {
                    this.step = 0x00;
                    this.x25519KeyExchangeData = new X25519KeyExchangeData(this.tlv);
                } else if (dataType == 0x02) {
                    parsePakeJsonPayload(this.tlv.getString(0x02));
                } else if (dataType == 0x03) {
                    // device identity string in tag 0x02 (e.g. "serial;mac;name"); not consumed yet.
                    this.step = 0x04;
                }
            }

            /**
             * Classic Huawei HiChain (device_auth) step routing: isoSalt / returnCodeMac /
             * encAuthToken. Used for non-PAKE devices; reached only from the tag-0x04 framing above.
             */
            private void parseHiChainJsonPayload(String json) throws ParseException {
                final JSONObject payload = parseJsonEnvelope(json);
                try {
                    if (payload.has("isoSalt")) {
                        this.step = 0x01;
                        this.step1Data = new Step1Data(payload);
                    } else if (payload.has("returnCodeMac")) {
                        this.step = 0x02;
                        this.step2Data = new Step2Data(payload);
                    } else if (payload.has("encAuthToken")) {
                        this.step = 0x03;
                        this.step3Data = new Step3Data(payload);
                    }
                } catch (JSONException e) {
                    throw new JsonException("", e);
                }
            }

            /**
             * Honor PAKE / STS-reconnect step routing: PAKE bind response/confirm/exchange plus the
             * STS messages 32785/32786. Used for PAKE devices (Honor Watch 5); reached only from the
             * Honor MBB dataType-0x02 framing above.
             *
             * Reconnect (STS) responses are routed by their message number, not by field sniffing:
             * AUTH_START_RESPONSE (32785) carries challenge/salt/epk just like a PAKE bind response
             * (32769) and would otherwise be mis-tagged as a bind step.
             */
            private void parsePakeJsonPayload(String json) throws ParseException {
                final JSONObject payload = parseJsonEnvelope(json);
                try {
                    final int message = value.optInt("message", -1);
                    if (message == 32785) {
                        this.step = STEP_STS_START;
                        this.stsStartData = new StsStartResponseData(payload);
                    } else if (message == 32786) {
                        this.step = STEP_STS_ACK;
                        this.stsAckData = new StsAckResponseData(payload);
                    } else if (payload.has("challenge") && payload.has("salt") && payload.has("epk")) {
                        this.step = 0x01;
                        this.pakeResponseData = new PakeResponseData(payload);
                    } else if (payload.has("kcfData")) {
                        this.step = 0x02;
                        this.pakeConfirmData = new PakeConfirmData(payload);
                    } else if (payload.has("exAuthInfo")) {
                        this.step = 0x03;
                        this.pakeExchangeData = new PakeExchangeData(payload);
                    }
                } catch (JSONException e) {
                    throw new JsonException("", e);
                }
            }

            /**
             * Parse the {@code {message, payload, errorCode}} JSON envelope common to both auth
             * stacks, populating {@link #value}/{@link #jsonPayload}/{@link #errorCode}, and return
             * the inner payload object for step-specific routing.
             */
            private JSONObject parseJsonEnvelope(String json) throws ParseException {
                try {
                    this.value = new JSONObject(json);
                    this.jsonPayload = value.getJSONObject("payload");
                    if (jsonPayload.has("errorCode")) {
                        this.errorCode = jsonPayload.getInt("errorCode");
                    }
                    return this.jsonPayload;
                } catch (JSONException e) {
                    throw new JsonException("", e);
                }
            }
        }

        public static class OutgoingRequest extends HuaweiPacket {
            public static class Step1Data {
                public byte[] isoSalt;
                public byte[] peerAuthId;
                public byte[] seed;
                public int peerUserType;

                String serviceType; // Optional

                public Step1Data(JSONObject payload) throws JSONException {
                    this.isoSalt = GB.hexStringToByteArray(payload.getString("isoSalt"));
                    this.peerAuthId = GB.hexStringToByteArray(payload.getString("peerAuthId"));
                    this.seed = GB.hexStringToByteArray(payload.getString("seed"));
                    this.peerUserType = payload.getInt("peerUserType");

                    if (payload.has("serviceType"))
                        this.serviceType = payload.getString("serviceType");
                }

                @NonNull
                @Override
                public String toString() {
                    return "Step1Data{" +
                            "isoSalt=" + StringUtils.bytesToHex(isoSalt) +
                            ", peerAuthId=" + StringUtils.bytesToHex(peerAuthId) +
                            ", seed=" + StringUtils.bytesToHex(seed) +
                            ", peerUserType=" + peerUserType +
                            ", serviceType='" + serviceType + '\'' +
                            '}';
                }
            }

            public static class Step2Data {
                public byte[] peerAuthId;
                public byte[] token;

                public boolean isDeviceLevel = false; // Optional

                public Step2Data(JSONObject payload) throws JSONException {
                    this.peerAuthId = GB.hexStringToByteArray(payload.getString("peerAuthId"));
                    this.token = GB.hexStringToByteArray(payload.getString("token"));

                    if (payload.has("isDeviceLevel"))
                        this.isDeviceLevel = payload.getBoolean("isDeviceLevel");
                }

                @NonNull
                @Override
                public String toString() {
                    return "Step2Data{" +
                            "peerAuthId=" + StringUtils.bytesToHex(peerAuthId) +
                            ", token=" + StringUtils.bytesToHex(token) +
                            ", isDeviceLevel=" + isDeviceLevel +
                            '}';
                }
            }

            public static class Step3Data {
                public byte[] nonce;
                public byte[] encData;

                public Step3Data(JSONObject payload) throws JSONException {
                    this.nonce = GB.hexStringToByteArray(payload.getString("nonce"));
                    this.encData = GB.hexStringToByteArray(payload.getString("encData"));
                }

                @NonNull
                @Override
                public String toString() {
                    return "Step3Data{" +
                            "nonce=" + StringUtils.bytesToHex(nonce) +
                            ", encData=" + StringUtils.bytesToHex(encData) +
                            '}';
                }
            }

            public static class Step4Data {
                public byte[] nonce;
                public byte[] encResult;

                public Step4Data(JSONObject payload) throws JSONException {
                    this.nonce = GB.hexStringToByteArray(payload.getString("nonce"));
                    this.encResult = GB.hexStringToByteArray(payload.getString("encResult"));
                }

                @NonNull
                @Override
                public String toString() {
                    return "Step4Data{" +
                            "nonce=" + StringUtils.bytesToHex(nonce) +
                            ", encResult=" + StringUtils.bytesToHex(encResult) +
                            '}';
                }
            }

            public int step;

            public long requestId;
            public byte[] selfAuthId;
            public String groupId;
            public JSONObject jsonPayload = null;
            public JSONObject value = null;

            public Step1Data step1Data;
            public Step2Data step2Data;
            public Step3Data step3Data;
            public Step4Data step4Data;

            public OutgoingRequest(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.complete = false;
            }

            @Override
            public void parseTlv() throws ParseException {
                try {
                    value = new JSONObject(this.tlv.getString(0x01));
                    jsonPayload = value.getJSONObject("payload");

                    if (jsonPayload.has("isoSalt")) {
                        this.step = 1;
                        this.step1Data = new Step1Data(jsonPayload);
                    } else if (jsonPayload.has("token")) {
                        this.step = 2;
                        this.step2Data = new Step2Data(jsonPayload);
                    } else if (jsonPayload.has("encData")) {
                        this.step = 3;
                        this.step3Data = new Step3Data(jsonPayload);
                    } else if (jsonPayload.has("encResult")) {
                        this.step = 4;
                        this.step4Data = new Step4Data(jsonPayload);
                    }
                } catch (JSONException e) {
                    throw new JsonException("Cannot parse JSON", e);
                }

                if (this.tlv.contains(0x03))
                    this.requestId = ByteBuffer.wrap(this.tlv.getBytes(0x03)).getLong();
            }
        }
    }

    public static class PinCode {
        public static final int id = 0x2C;

        public static class Request extends HuaweiPacket {

            public Request(HuaweiPacket.ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                    .put(0x01);
                this.complete = true;
                this.isEncrypted = false;
            }
        }

        public static class Response extends HuaweiPacket {
            public byte[] pinCode;

            public Response(HuaweiPacket.ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
                this.isEncrypted = false;
            }

            @Override
            public void parseTlv() throws ParseException {
                byte[] message = this.tlv.getBytes(0x01);
                byte[] iv = this.tlv.getBytes(0x02);

                HuaweiCrypto huaweiCrypto = new HuaweiCrypto(paramsProvider.getAuthVersion(), paramsProvider.getAuthAlgo(), paramsProvider.getDeviceSupportType(), paramsProvider.getAuthMode());
                try {
                    pinCode = huaweiCrypto.decryptPinCode(paramsProvider.getEncryptMethod(), message, iv);
                } catch (HuaweiCrypto.CryptoException e) {
                    throw new CryptoException("Could not decrypt pinCode", e);
                }
            }
        }
        // TODO: implement parsing this request for the log parser support
    }

    public static class AcceptAgreement {
        public static final int id = 0x30;

        public static class Request extends HuaweiPacket {
            public Request(ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                long timestamp = System.currentTimeMillis();

                HuaweiTLV software = new HuaweiTLV()
                                .put(0x03, "software_update_service_statement")
                                .put(0x04, (byte)0x01)
                                .put(0x05, "20230508-20230508-0-0")
                                .put(0x06, String.valueOf(timestamp));
                HuaweiTLV device_information = new HuaweiTLV()
                                .put(0x03, "device_information_management")
                                .put(0x04,(byte)0x01)
                                .put(0x05, "20230508-20230508-0-0")
                                .put(0x06,String.valueOf(timestamp));
                HuaweiTLV user_license = new HuaweiTLV()
                                .put(0x03, "user_license_agreement")
                                .put(0x04,(byte)0x01)
                                .put(0x05, "20230508-20230508-0-0")
                                .put(0x06,String.valueOf(timestamp));
                HuaweiTLV tlvList = new HuaweiTLV()
                        .put(0x82, software)
                        .put(0x82, device_information)
                        .put(0x82, user_license);
                this.tlv = new HuaweiTLV()
                        .put(0x81, tlvList);
            }
        }
        
    }


    public static class SettingRelated {
        public static final int id = 0x31;

        public static class Request extends HuaweiPacket {
            public Request(ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                    .put(0x01)
                    .put(0x02)
                    .put(0x03)
                    .put(0x04)
                    .put(0x05)
                    .put(0x06);

                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {
            public boolean truSleepNewSync = false;
            public boolean rriNewSync = false;
            public boolean gpsNewSync = false;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
            }

            @Override
            public void parseTlv() throws ParseException {
                // Works with bitmaps

                // Tag 1 -> LegalStuff

                if (this.tlv.contains(0x02)) {
                    // Tag 2 -> File support
                    byte value = this.tlv.getByte(0x02);
                    truSleepNewSync = (value & 2) != 0;
                    rriNewSync = (value & 4) != 0;
                    gpsNewSync = (value & 8) != 0;
                }

                // Tag 3 -> SmartWatchVersion
                // Tag 4 to 6 are HMS related
            }
        }
    }

    public static class TimeZoneIdRequest extends HuaweiPacket {
        public static final byte id = 0x32;

        public TimeZoneIdRequest(
                ParamsProvider paramsProvider) {
            super(paramsProvider);
            this.serviceId = DeviceConfig.id;
            this.commandId = id;
            ByteBuffer timeAndZoneId = ByteBuffer.wrap(HuaweiUtil.getTimeAndZoneId(Calendar.getInstance()));
            this.tlv = new HuaweiTLV()
                    .put(0x01, timeAndZoneId.getInt())
                    .put(0x02, timeAndZoneId.getShort());
            byte[] zoneId = new byte[timeAndZoneId.remaining()];
            timeAndZoneId.get(zoneId, 0, timeAndZoneId.remaining());
            this.tlv.put(0x03, zoneId);
            this.complete = true;
        }

        // TODO: implement parsing this request for the log parser support
    }

    public static class SecurityNegotiation {
        public static final int id = 0x33;

        public static class Request extends HuaweiPacket {

            public Request (
                    HuaweiPacket.ParamsProvider paramsProvider,
                    byte authMode,
                    byte[] deviceUUID,
                    String phoneModel) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                    .put(0x01, authMode);
                if (authMode == 0x02 || authMode == 0x04)
                    this.tlv.put(0x02, (byte)0x01); //force to not reconnected else 0x02
                this.tlv.put(0x05, deviceUUID)
                        .put(0x03, (byte)0x01)
                        .put(0x04, (byte)0x00);
                if (authMode == 0x04)
                    this.tlv.put(0x06)
                            .put(0x07, phoneModel);
                if (paramsProvider.getEncryptMethod() == 1 )
                        this.tlv.put(0xd, (byte)0x1);


                this.complete = true;
                this.isEncrypted = false;
            }

            /**
             * Honor MBB auth-type request (mirrors the official app's {@code packAuthTypeRequest}):
             * tag 0x01 = authType, tag 0x02 = pairType (1 = FIRST_PAIR, 2 = RECONNECT), tag 0x03 =
             * our own authId so the watch can look us up in its trust store. Used only by PAKE
             * devices (Honor Watch 5); the generic constructor above is unchanged for every other
             * Huawei device. The wire layout was confirmed from the pairing capture (frame 897).
             */
            public Request(
                    HuaweiPacket.ParamsProvider paramsProvider,
                    byte authType,
                    int honorPairType,
                    byte[] selfAuthId) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                        .put(0x01, authType)
                        .put(0x02, (byte) honorPairType)
                        .put(0x03, selfAuthId);

                this.complete = true;
                this.isEncrypted = false;
            }
            // TODO: implement parsing this request for the log parser support
        }

        public static class Response extends HuaweiPacket {
            public int authType;
            // Negotiated pairType (tag 0x02): 1 = FIRST_PAIR (watch wants a fresh bind),
            // 2 = RECONNECT (watch trusts us, do STS). Honor watches report this to dictate the
            // auth path; -1 means the watch omitted it. Observed from the pairing capture.
            public int honorPairType = -1;
            public byte[] responseNonce;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
            }

            @Override
            public void parseTlv() throws ParseException {
                this.authType = -0x1;
                int pw = -0x1;
                if (this.tlv.contains(0x01)) {
                    if (this.tlv.getByte(0x01) == 0x01)
                        this.authType = 0x0186A0;
                    if (this.tlv.getByte(0x01) == 0x04)
                        pw = 4;
                }
                if (this.tlv.contains(0x02)) {
                    // Tag 0x02 is overloaded: on Honor watches it is the pairType (1 = FIRST_PAIR,
                    // 2 = RECONNECT), on classic Huawei devices it is the negotiated authType. Both
                    // fields capture it; each device family reads only the one meaningful to it.
                    this.honorPairType = (int)this.tlv.getByte(0x02);
                    this.authType = (int)this.tlv.getByte(0x02);
                    if (pw != -0x1)
                        this.authType ^= pw;
                }
                if (this.tlv.contains(0x7F))
                    this.authType = (int)this.tlv.getByte(0x7F);
                if (this.tlv.contains(0x03))
                    this.responseNonce = this.tlv.getBytes(0x03);
            }
        }
    }

    public static class ConnectStatusRequest extends HuaweiPacket {
        public static final int id = 0x35;

        public ConnectStatusRequest (HuaweiPacket.ParamsProvider paramsProvider) {
            super(paramsProvider);

            this.serviceId = DeviceConfig.id;
            this.commandId = id;

            this.tlv = new HuaweiTLV()
                .put(0x01,(byte)0x01);
            this.complete = true;
        }
        // TODO: implement parsing this request for the log parser support
    }


    public static class ExpandCapability {
        public static final int id = 0x37;

        public static class Request extends HuaweiPacket {
            public Request(ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                    .put(0x01);

                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {
            public byte[] expandCapabilities;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
            }

            @Override
            public void parseTlv() throws ParseException {
                if (this.tlv.contains(0x01)) {
                    this.expandCapabilities = this.tlv.getBytes(0x01);
                }
            }
        }

    }

    // Negotiates a second RFCOMM socket ("dual channel") and the routing tables that decide
    // which services/commands are sent over it. Gated on expand-capability bit 56 (dual socket)
    // and bit 142 (extend socket). See DUAL_CHANNEL_NOTES for the reverse-engineered format.
    public static class DualChannel {
        public static final int id = 0x3C;

        // Services that must never be routed to the extra channel (vendor DeviceDualChannelHelper.e).
        public static final byte[] alwaysMainChannelServices = new byte[]{0x28, 0x2C};

        // One entry per service that has per-command or per-package routing to the extra channel.
        public static class ChannelEntry {
            public byte service;
            public byte[] commands = new byte[0];      // command ids routed to the extra channel
            public List<String> packages = new ArrayList<>(); // P2P destination package names (services 0x34/0x37)
        }

        public static class Request extends HuaweiPacket {
            public Request(ParamsProvider paramsProvider, boolean supportsExtend) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                // All-empty tags: ask the watch to fill them in. Extend format adds tags 3 and 4.
                this.tlv = new HuaweiTLV()
                    .put(0x01)
                    .put(0x02);
                if (supportsExtend) {
                    this.tlv.put(0x03).put(0x04);
                }

                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {
            public int channel = 0;                 // tag 1: RFCOMM channel of the extra socket
            public byte[] dualServices = new byte[0];   // tag 2: services routed wholesale to extra channel
            public byte[] fileTypes = new byte[0];      // tag 3: file types (extend only)
            public List<ChannelEntry> entries = new ArrayList<>(); // tag 0x84 -> 0x85 entries (extend only)

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
            }

            @Override
            public void parseTlv() throws ParseException {
                if (this.tlv.contains(0x01))
                    this.channel = this.tlv.getAsInteger(0x01);
                if (this.tlv.contains(0x02))
                    this.dualServices = this.tlv.getBytes(0x02);
                if (this.tlv.contains(0x03))
                    this.fileTypes = this.tlv.getBytes(0x03);
                if (this.tlv.contains(0x84)) {
                    HuaweiTLV container = this.tlv.getObject(0x84);
                    for (HuaweiTLV entryTlv : container.getObjects(0x85)) {
                        ChannelEntry entry = new ChannelEntry();
                        if (entryTlv.contains(0x06))
                            entry.service = entryTlv.getByte(0x06);
                        if (entryTlv.contains(0x07))
                            entry.commands = entryTlv.getBytes(0x07);
                        if (entryTlv.contains(0x08)) {
                            String names = new String(entryTlv.getBytes(0x08), StandardCharsets.UTF_8);
                            entry.packages = Arrays.asList(names.split("#"));
                        }
                        this.entries.add(entry);
                    }
                }
            }
        }
    }

    public static class PermissionCheck {
        public static final byte id = 0x38;
        // NOTE: request from the watch
        public static class PermissionCheckRequest extends HuaweiPacket {
            public short permission = 0;

            public PermissionCheckRequest(ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;
            }

            @Override
            public void parseTlv() throws ParseException {
                if (this.tlv.contains(0x01))
                    this.permission = this.tlv.getShort(0x01);
            }
        }

        public static class PermissionCheckResponse extends HuaweiPacket {

            public PermissionCheckResponse(
                    ParamsProvider paramsProvider,
                    short permission,
                    short status
            ) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                        .put(0x01, permission)
                        .put(0x02, status);

                this.complete = true;
            }
        }

    }

    public static class WearStatus {
        public static final int id = 0x3D;

        public static class Request extends HuaweiPacket {
            public Request(ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                    .put(0x01);

                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
            }

            @Override
            public void parseTlv() throws ParseException {
            }
        }
    }

    public static class SetUpDeviceStatusRequest extends HuaweiPacket {
        public static final int id = 0x3E;

        public SetUpDeviceStatusRequest(ParamsProvider paramsProvider, int relationShip, String deviceName) {
            super(paramsProvider);

            this.serviceId = DeviceConfig.id;
            this.commandId = id;

            this.tlv = new HuaweiTLV()
                .put(0x01, (byte) relationShip)
                .put(0x02, deviceName)
                .put(0x03, (byte)0x00);

            this.complete = true;
        }
    }

    public static class ReverseCapabilities {
        public static final int id = 0x3f;

        // JoyoFit: Huawei Health 17.0.8.300's own bitmap for this watch (sign-capture.log, ReverseCapabilityConfigUtil):
        // GB's bits plus 22, 43 and 47..59. It makes the watch ask for config 900100007 (FeatureConfig.kt answers it).
        public static final byte[] HUAWEI_HEALTH = {(byte) 0xFD, (byte) 0xF7, 0x73, (byte) 0xFA, 0x29, (byte) 0xBF, (byte) 0xFF, 0x0F};
        // JoyoFit: Gadgetbridge's bitmap, sent when the user turned on "Compatibility install". GB installs unsigned faces on a Fit 3
        // that refuses them from JoyoFit with Huawei Health's bitmap (docs/watchfaces-signing.md, section 0c).
        public static final byte[] GADGETBRIDGE = {(byte) 0xFD, (byte) 0xF7, 0x33, (byte) 0xFA, 0x29, 0x37};

        public static class Request extends HuaweiPacket {
            public Request(ParamsProvider paramsProvider) {
                this(paramsProvider, false);
            }

            public Request(ParamsProvider paramsProvider, boolean gadgetbridge) {
                super(paramsProvider);

                this.serviceId = DeviceConfig.id;
                this.commandId = id;

                // Bits like ext capabilities
                //byte[] capabilities = {(byte) 0xFD, (byte) 0xF7, (byte)0x73, (byte)0x7A};
                byte[] capabilities = gadgetbridge ? GADGETBRIDGE : HUAWEI_HEALTH;
                this.tlv = new HuaweiTLV()
                        .put(0x01, capabilities);

                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = DeviceConfig.id;
                this.commandId = id;
            }

            @Override
            public void parseTlv() throws ParseException {
            }
        }
    }

    // TODO: wear location enum?

    public static class Date {
        // TODO: enum?

        public static final int yearFirst = 0x01;
        public static final int monthFirst = 0x02;
        public static final int dayFirst = 0x03;
    }

    public static class Time {
        // TODO: enum?

        public static final int hours12 = 0x01;
        public static final int hours24 = 0x02;
    }
}

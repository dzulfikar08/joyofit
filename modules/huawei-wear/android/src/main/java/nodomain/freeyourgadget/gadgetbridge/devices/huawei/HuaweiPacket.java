/*  Copyright (C) 2024 Damien Gaignon, Martin.JM

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

// Modified for watch-fit (AGPL-3.0-or-later): parse()/parseOutgoing() also dispatch the Weather service (support, start, forecast).
// Modified for watch-fit (AGPL-3.0-or-later): parse() also dispatches the Workout service (0x17).
// Modified for watch-fit (AGPL-3.0-or-later): parse()/parseOutgoing() dispatch limited to the ported packet classes (DeviceConfig, FitnessData, FileDownloadService0A/2C, Notifications constraints/capabilities); other packet classes not ported.
// Modified for watch-fit (AGPL-3.0-or-later): parse() also dispatches the FileUpload (0x28) and Watchface (0x27) services; WatchfaceOperation (0x27/0x03) is parsed too (GB leaves it generic).
// Modified for watch-fit (AGPL-3.0-or-later): parse() also dispatches the P2P service (0x34/0x01, packets/P2P.java).
// Modified for watch-fit (AGPL-3.0-or-later): parse() also dispatches the MusicControl service (0x25).
package nodomain.freeyourgadget.gadgetbridge.devices.huawei;

import static nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiConstants.HUAWEI_MAGIC;

import androidx.annotation.NonNull;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.DeviceConfig;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FitnessData;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FileDownloadService0A;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FileDownloadService2C;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Notifications;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Alarms;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Calls;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.DataSync;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FindPhone;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.P2P;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Workout;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Weather;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FileUpload;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Watchface;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl;
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums;

public class HuaweiPacket {
    private static final Logger LOG = LoggerFactory.getLogger(HuaweiPacket.class);

    public static class ParamsProvider {

        protected byte authVersion;
        protected byte deviceSupportType;
        protected byte[] secretKey;
        protected int slicesize = 0xf4;
        protected boolean transactionsCrypted = true;
        protected int mtu = 65535;
        protected long encryptionCounter = 0;

        protected byte[] pinCode = null;

        protected byte interval;
        protected byte authAlgo;
        protected byte encryptMethod;
        protected byte[] firstKey;
        protected byte authMode;

        protected boolean isAW = false;

        public void setAuthVersion(byte authVersion) {
            this.authVersion = authVersion;
        }

        public byte getAuthVersion() {
            return this.authVersion;
        }

        public void setDeviceSupportType(byte deviceSupportType) {
            this.deviceSupportType = deviceSupportType;
        }

        public byte getDeviceSupportType(){
            return this.deviceSupportType;
        }

        public void setSecretKey(byte[] secretKey) {
            this.secretKey = secretKey;
        }

        public byte[] getSecretKey() {
            return this.secretKey;
        }

        public void setTransactionsCrypted(boolean transactionsCrypted) {
            this.transactionsCrypted = transactionsCrypted;
        }

        public boolean areTransactionsCrypted() {
            return this.transactionsCrypted;
        }

        public void setMtu(int mtu) {
            this.mtu = mtu;
        }

        public int getMtu() {
            return this.mtu;
        }

        public void setSliceSize(int sliceSize) {
            this.slicesize = sliceSize;
        }

        public int getSliceSize() {
            return this.slicesize;
        }
        public void setPinCode(byte[] pinCode) {
            this.pinCode = pinCode;
        }

        public byte[] getPinCode() {
            return this.pinCode;
        }

        public void setInterval(byte interval) {
            this.interval = interval;
        }

        public byte getInterval() {
            return this.interval;
        }

        public byte getAuthMode() { return this.authMode; }

        public void setAuthMode(byte authMode) { this.authMode = authMode; }

        public byte[] getIv() {
            byte[] iv;
            if (this.deviceSupportType == 0x04) {
                iv = HuaweiCrypto.generateNonce();
            } else {
                ByteBuffer ivCounter = HuaweiCrypto.initializationVector(this.encryptionCounter);
                iv = ivCounter.array();
                this.encryptionCounter = (long)ivCounter.getInt(12) & 0xFFFFFFFFL;
            }
            return iv;
        }

        public void setEncryptionCounter(long counter) {
            this.encryptionCounter = counter;
        }

        public void setAuthAlgo(byte authAlgo) {
            this.authAlgo = authAlgo;
        }

        public byte getAuthAlgo () {
            return this.authAlgo;
        }

        public void setEncryptMethod(byte encryptMethod) {
            this.encryptMethod = encryptMethod;
        }

        public byte getEncryptMethod () {
            return this.encryptMethod;
        }

        public void setFirstKey(byte[] firstKey) {
            this.firstKey = firstKey;
        }

        public byte[] getFirstKey() {
            return firstKey;
        }

        public boolean isAW() {
            return isAW;
        }

        public void setAW(boolean AW) {
            isAW = AW;
        }
    }

    public static abstract class ParseException extends Exception {
        ParseException(String message) {
            super(message);
        }

        ParseException(String message, Exception e) {
            super(message, e);
        }
    }

    public static class LengthMismatchException extends ParseException {
        public LengthMismatchException(String message) {
            super(message);
        }
    }

    public static class MagicMismatchException extends ParseException {
        MagicMismatchException(String message) {
            super(message);
        }
    }

    public static class ChecksumIncorrectException extends ParseException {
        ChecksumIncorrectException(String message) {
            super(message);
        }
    }

    public static class MissingTagException extends ParseException {
        public MissingTagException(int tag) {
            super("Missing tag: " + Integer.toHexString(tag));
        }
    }

    public static class CryptoException extends ParseException {
        public CryptoException(String message, Exception e) {
            super(message, e);
        }
    }

    public static class JsonException extends ParseException {
        public JsonException(String message, Exception e) {
            super(message, e);
        }
    }

    public static class SupportedCommandsListException extends ParseException {
        public SupportedCommandsListException(String message) {
            super(message);
        }
    }

    public static class SerializeException extends Exception {
        public SerializeException(String message) {
            super(message);
        }
        public SerializeException(String message, Exception e) {
            super(message, e);
        }
    }

    protected static final int PACKET_MINIMAL_SIZE = 3; // magic + data size

    protected ParamsProvider paramsProvider;

    public byte serviceId = 0;
    public byte commandId = 0;
    protected HuaweiTLV tlv = null;

    private byte[] partialPacket = null;
    protected byte[] payload = null;

    public boolean complete = false;

    // Encryption is enabled by default, packets which don't use it must disable it
    protected boolean isEncrypted = true;

    protected boolean isSliced = true;

    public HuaweiPacket(ParamsProvider paramsProvider) {
        this.paramsProvider = paramsProvider;
    }

    public boolean attemptDecrypt() throws ParseException {
        if (paramsProvider == null || paramsProvider.getSecretKey() == null)
            return false;
        if (this.tlv == null)
            return false;
        if (this.tlv.contains(0x7C) && this.tlv.getBoolean(0x7C)) {
            try {
                this.tlv.decrypt(paramsProvider);
                return true;
            } catch (HuaweiCrypto.CryptoException e) {
                throw new CryptoException("Decrypt exception", e);
            }
        } else {
            if (this.isEncrypted && paramsProvider.areTransactionsCrypted()) {
                // TODO: potentially a log message? We expect it to be encrypted, but it isn't.
            }
        }
        return false;
    }

    /*
     * This function is to convert the Packet into the proper subclass
     */
    protected HuaweiPacket fromPacket(HuaweiPacket packet) throws ParseException {
        this.paramsProvider = packet.paramsProvider;
        this.serviceId = packet.serviceId;
        this.commandId = packet.commandId;
        this.tlv = packet.tlv;
        this.partialPacket = packet.partialPacket;
        this.payload = packet.payload;
        this.complete = packet.complete;
        this.left = packet.left;

        if (packet.isEncrypted)
            this.isEncrypted = true;
        else
            this.isEncrypted = this.attemptDecrypt();

        return this;
    }

    /*
     * This function is to set up the subclass for easy usage
     * Needs to be called separately so the exceptions can be used more easily
     */
    public void parseTlv() throws ParseException {}

    private int left = 0;

    public int getLeft() {
        return this.left;
    }

    private void parseData(byte[] data) throws ParseException {
        this.left = 0;
        if (partialPacket != null) {
            int newCapacity = partialPacket.length + data.length;
            data = ByteBuffer.allocate(newCapacity)
                    .put(partialPacket)
                    .put(data)
                    .array();
        }

        ByteBuffer buffer = ByteBuffer.wrap(data);
        if (buffer.capacity() < 1) {
            throw new LengthMismatchException("Packet length mismatch : "
                    + buffer.capacity()
                    + " < 1");
        }

        byte magic = buffer.get();

        if (magic != HUAWEI_MAGIC) {
            throw new MagicMismatchException("Magic mismatch : "
                    + Integer.toHexString(magic)
                    + " != 0x5A");
        }

        if (buffer.capacity() < PACKET_MINIMAL_SIZE) {
            this.partialPacket = data;
            return;
        }

        short expectedSize = buffer.getShort();

        if(expectedSize < 0) {
            throw new LengthMismatchException("Expected length mismatch : " + expectedSize);
        }

        if (expectedSize + 2 > buffer.remaining()) {
            // Older band and BT version do not handle message with more than 256 bits.
            this.partialPacket = data;
            return;
        }

        this.partialPacket = null;

        int addLen = 1;
        int isSliced = buffer.get();
        if (isSliced == 1 || isSliced == 2 || isSliced == 3) {
            buffer.get(); // Throw away slice flag
            addLen++;
        }

        byte[] newPayload = new byte[expectedSize - addLen];
        buffer.get(newPayload, 0, expectedSize - addLen);
        short expectedChecksum = buffer.getShort();
        this.left = buffer.remaining();
        buffer.rewind();

        byte[] dataNoCRC = new byte[expectedSize + 3];
        buffer.get(dataNoCRC, 0, expectedSize + 3);
        short actualChecksum = (short) CheckSums.getCRC16(dataNoCRC, 0x0000);
        if (actualChecksum != expectedChecksum) {
            throw new ChecksumIncorrectException("Checksum mismatch : "
                    + String.valueOf(actualChecksum)
                    + " != "
                    + String.valueOf(expectedChecksum));
        }

        if (isSliced == 1 || isSliced == 2 || isSliced == 3) {
            if (payload != null) {
                int newCapacity = payload.length + newPayload.length;
                newPayload = ByteBuffer.allocate(newCapacity)
                        .put(payload)
                        .put(newPayload)
                        .array();
            }

            if (isSliced != 3) {
                // Sliced packet isn't complete yet
                this.payload = newPayload;
                return;
            }
        }

        this.serviceId = newPayload[0];
        this.commandId = newPayload[1];
        this.complete = true;

        if (
                (serviceId == 0x0a && commandId == 0x05) ||
                (serviceId == 0x28 && commandId == 0x06) ||
                (serviceId == 0x2c && commandId == 0x05) ||
                (serviceId == 0x1c && commandId == 0x05)
        ) {
            // TODO: this doesn't seem to be TLV
            this.payload = newPayload;
            return;
        }

        this.tlv = new HuaweiTLV();
        this.tlv.parse(newPayload, 2, newPayload.length - 2);
    }

    public HuaweiPacket parse(byte[] data) throws ParseException {
        this.isEncrypted = false; // Will be changed if decrypt has been performed

        parseData(data);
        if (!this.complete)
            return this;

        switch (this.serviceId) {
            case DeviceConfig.id:
                switch (this.commandId) {
                    case DeviceConfig.LinkParams.id:
                        return new DeviceConfig.LinkParams.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.SupportedServices.id:
                        return new DeviceConfig.SupportedServices.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.SupportedCommands.id:
                        return new DeviceConfig.SupportedCommands.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.TimeRequest.id:
                        return new DeviceConfig.TimeRequest.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.ProductInfo.id:
                        return new DeviceConfig.ProductInfo.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.BondParams.id:
                        return new DeviceConfig.BondParams.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.PhoneInfo.id:
                        return new DeviceConfig.PhoneInfo.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.Auth.id:
                        return new DeviceConfig.Auth.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.BatteryLevel.id:
                    case DeviceConfig.BatteryLevel.id_change:
                        return new DeviceConfig.BatteryLevel.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.DeviceStatus.id:
                        return new DeviceConfig.DeviceStatus.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.DndLiftWristType.id:
                        return new DeviceConfig.DndLiftWristType.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.GetDefaultSwitch.id:
                        return new DeviceConfig.GetDefaultSwitch.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.HiChain.id:
                        return new DeviceConfig.HiChain.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.PinCode.id:
                        return new DeviceConfig.PinCode.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.ExpandCapability.id:
                        return new DeviceConfig.ExpandCapability.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.DualChannel.id:
                        return new DeviceConfig.DualChannel.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.ActivityType.id:
                        return new DeviceConfig.ActivityType.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.SettingRelated.id:
                        return new DeviceConfig.SettingRelated.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.PermissionCheck.id:
                        return new DeviceConfig.PermissionCheck.PermissionCheckRequest(paramsProvider).fromPacket(this);
                    case DeviceConfig.SecurityNegotiation.id:
                        return new DeviceConfig.SecurityNegotiation.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.WearStatus.id:
                        return new DeviceConfig.WearStatus.Response(paramsProvider).fromPacket(this);
                    case DeviceConfig.ReverseCapabilities.id:
                        return new DeviceConfig.ReverseCapabilities.Response(paramsProvider).fromPacket(this);

                    default:
                        this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                        return this;
                }
            case FitnessData.id:
                switch (this.commandId) {
                    case FitnessData.FitnessTotals.id:
                        return new FitnessData.FitnessTotals.Response(paramsProvider).fromPacket(this);
                    case FitnessData.MessageCount.stepId:
                        return new FitnessData.MessageCount.Response(paramsProvider).fromPacket(this);
                    case FitnessData.MessageData.stepId:
                        return new FitnessData.MessageData.StepResponse(paramsProvider).fromPacket(this);
                    case FitnessData.MessageCount.sleepId:
                        return new FitnessData.MessageCount.Response(paramsProvider).fromPacket(this);
                    case FitnessData.MessageData.sleepId:
                        return new FitnessData.MessageData.SleepResponse(paramsProvider).fromPacket(this);
                    default:
                        this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                        return this;
                }
            case Notifications.id:
                switch (this.commandId) {
                    case Notifications.NotificationConstraints.id:
                        return new Notifications.NotificationConstraints.Response(paramsProvider).fromPacket(this);
                    case Notifications.NotificationCapabilities.id:
                        return new Notifications.NotificationCapabilities.Response(paramsProvider).fromPacket(this);
                    case Notifications.NotificationReply.id:
                        return new Notifications.NotificationReply.ReplyResponse(paramsProvider).fromPacket(this);
                    default:
                        this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                        return this;
                }
            case FileDownloadService0A.id:
                switch (this.commandId) {
                    case FileDownloadService0A.FileDownloadInit.id:
                        return new FileDownloadService0A.FileDownloadInit.Response(paramsProvider).fromPacket(this);
                    case FileDownloadService0A.FileParameters.id:
                        return new FileDownloadService0A.FileParameters.Response(paramsProvider).fromPacket(this);
                    case FileDownloadService0A.FileInfo.id:
                        return new FileDownloadService0A.FileInfo.Response(paramsProvider).fromPacket(this);
                    case FileDownloadService0A.RequestBlock.id:
                        return new FileDownloadService0A.RequestBlock.Response(paramsProvider).fromPacket(this);
                    case FileDownloadService0A.BlockResponse.id:
                        return new FileDownloadService0A.BlockResponse(paramsProvider).fromPacket(this);
                    default:
                        this.isEncrypted = this.attemptDecrypt();
                        return this;
                }
            case FileDownloadService2C.id:
                switch (this.commandId) {
                    case FileDownloadService2C.FileDownloadInit.id:
                        return new FileDownloadService2C.FileDownloadInit.Response(paramsProvider).fromPacket(this);
                    case FileDownloadService2C.FileRequestHash.id:
                        return new FileDownloadService2C.FileRequestHash.Response(paramsProvider).fromPacket(this);
                    case FileDownloadService2C.FileInfo.id:
                        return new FileDownloadService2C.FileInfo.Response(paramsProvider).fromPacket(this);
                    case FileDownloadService2C.BlockResponse.id:
                        return new FileDownloadService2C.BlockResponse(paramsProvider).fromPacket(this);
                    case FileDownloadService2C.IncomingInitRequest.id:
                        return new FileDownloadService2C.IncomingInitRequest.Response(paramsProvider).fromPacket(this);
                    default:
                        this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                        return this;
                }
            case FindPhone.id:
                if (this.commandId == FindPhone.Response.id)
                    return new FindPhone.Response(paramsProvider).fromPacket(this);
                this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                return this;
            case Calls.id:
                if (this.commandId == Calls.AnswerCallResponse.id)
                    return new Calls.AnswerCallResponse(paramsProvider).fromPacket(this);
                this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                return this;
            case Alarms.id:
                switch (this.commandId) {
                    case Alarms.EventAlarmsList.id:
                        return new Alarms.EventAlarmsList.Response(paramsProvider).fromPacket(this);
                    case Alarms.SmartAlarmList.id:
                        return new Alarms.SmartAlarmList.Response(paramsProvider).fromPacket(this);
                    default:
                        this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                        return this;
                }
            case P2P.id:
                switch (this.commandId) {
                    case P2P.P2PCommand.id:
                        return new P2P.P2PCommand.Response(paramsProvider).fromPacket(this);
                    default:
                        this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                        return this;
                }
            case DataSync.id:
                switch (this.commandId) {
                    case DataSync.ConfigCommand.id:
                        return new DataSync.ConfigCommand.Response(paramsProvider).fromPacket(this);
                    case DataSync.EventCommand.id:
                        return new DataSync.EventCommand.Response(paramsProvider).fromPacket(this);
                    case DataSync.DataCommand.id:
                        return new DataSync.DataCommand.Response(paramsProvider).fromPacket(this);
                    case DataSync.DictDataCommand.id:
                        return new DataSync.DictDataCommand.Response(paramsProvider).fromPacket(this);
                    default:
                        this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                        return this;
                }
            case Weather.id:
                switch (this.commandId) {
                    case Weather.WeatherSupport.id:
                        return new Weather.WeatherSupport.Response(paramsProvider).fromPacket(this);
                    case Weather.WeatherExtendedSupport.id:
                        return new Weather.WeatherExtendedSupport.Response(paramsProvider).fromPacket(this);
                    case Weather.WeatherStart.id:
                        return new Weather.WeatherStart.Response(paramsProvider).fromPacket(this);
                    case Weather.WeatherSunMoonSupport.id:
                        return new Weather.WeatherSunMoonSupport.Response(paramsProvider).fromPacket(this);
                    default:
                        this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                        return this;
                }
            case Workout.id:
                switch (this.commandId) {
                    case Workout.WorkoutCount.id:
                        return new Workout.WorkoutCount.Response(paramsProvider).fromPacket(this);
                    case Workout.WorkoutTotals.id:
                        return new Workout.WorkoutTotals.Response(paramsProvider).fromPacket(this);
                    case Workout.WorkoutData.id:
                        return new Workout.WorkoutData.Response(paramsProvider).fromPacket(this);
                    case Workout.WorkoutPace.id:
                        return new Workout.WorkoutPace.Response(paramsProvider).fromPacket(this);
                    case Workout.WorkoutSwimSegments.id:
                        return new Workout.WorkoutSwimSegments.Response(paramsProvider).fromPacket(this);
                    case Workout.WorkoutSpO2.id:
                        return new Workout.WorkoutSpO2.Response(paramsProvider).fromPacket(this);
                    case Workout.WorkoutCapability.id:
                        return new Workout.WorkoutCapability.Response(paramsProvider).fromPacket(this);
                    case Workout.WorkoutSections.id:
                        return new Workout.WorkoutSections.Response(paramsProvider).fromPacket(this);
                    default:
                        this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                        return this;
                }
            case FileUpload.id:
                switch (this.commandId) {
                    case FileUpload.FileInfoSend.id:
                        return new FileUpload.FileInfoSend.Response(paramsProvider).fromPacket(this);
                    case FileUpload.FileHashSend.id:
                        return new FileUpload.FileHashSend.Response(paramsProvider).fromPacket(this);
                    case FileUpload.FileUploadConsultAck.id:
                        return new FileUpload.FileUploadConsultAck.Response(paramsProvider).fromPacket(this);
                    case FileUpload.FileNextChunkParams.id:
                        return new FileUpload.FileNextChunkParams(paramsProvider).fromPacket(this);
                    case FileUpload.FileUploadResult.id:
                        return new FileUpload.FileUploadResult.Response(paramsProvider).fromPacket(this);
                    case FileUpload.FileUploadDeviceResponse.id:
                        return new FileUpload.FileUploadDeviceResponse.Response(paramsProvider).fromPacket(this);
                    default:
                        this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                        return this;
                }
            case Watchface.id:
                switch (this.commandId) {
                    case Watchface.WatchfaceParams.id:
                        return new Watchface.WatchfaceParams.Response(paramsProvider).fromPacket(this);
                    case Watchface.DeviceWatchInfo.id:
                        return new Watchface.DeviceWatchInfo.Response(paramsProvider).fromPacket(this);
                    case Watchface.WatchfaceOperation.id:
                        return new Watchface.WatchfaceOperation.Response(paramsProvider).fromPacket(this);
                    case Watchface.WatchfaceConfirm.id:
                        return new Watchface.WatchfaceConfirm.Response(paramsProvider).fromPacket(this);
                    case Watchface.WatchfaceNameInfo.id:
                        return new Watchface.WatchfaceNameInfo.Response(paramsProvider).fromPacket(this);
                    default:
                        this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                        return this;
                }
            // Modified for watch-fit (AGPL-3.0-or-later): dispatches MusicControl packets (status 01, info 02, control 03).
            case MusicControl.id:
                switch (this.commandId) {
                    case MusicControl.MusicStatusResponse.id:
                        return new MusicControl.MusicStatusResponse(paramsProvider).fromPacket(this);
                    case MusicControl.MusicInfo.id:
                        return new MusicControl.MusicInfo.Response(paramsProvider).fromPacket(this);
                    case MusicControl.Control.id:
                        return new MusicControl.Control.Response(paramsProvider).fromPacket(this);
                    default:
                        this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                        return this;
                }
            default:
                this.isEncrypted = this.attemptDecrypt(); // Helps with debugging
                return this;
        }
    }

    public HuaweiPacket parseOutgoing(byte[] data) throws ParseException {
        this.isEncrypted = false; // Will be changed if decrypt has been performed

        parseData(data);
        if (!this.complete)
            return this;

        // TODO: complete

        switch (this.serviceId) {
            case DeviceConfig.id:
                switch (this.commandId) {
                    case DeviceConfig.SupportedServices.id:
                        return new DeviceConfig.SupportedServices.OutgoingRequest(paramsProvider).fromPacket(this);
                    case DeviceConfig.DateFormat.id:
                        return new DeviceConfig.DateFormat.OutgoingRequest(paramsProvider).fromPacket(this);
                    case DeviceConfig.Bond.id:
                        return new DeviceConfig.Bond.OutgoingRequest(paramsProvider).fromPacket(this);
                    case DeviceConfig.HiChain.id:
                        return new DeviceConfig.HiChain.OutgoingRequest(paramsProvider).fromPacket(this);
                    case DeviceConfig.Auth.id:
                        return new DeviceConfig.Auth.OutgoingRequest(paramsProvider).fromPacket(this);
                    default:
                        return this;
                }
            case Weather.id:
                switch (this.commandId) {
                    case Weather.WeatherForecastData.id:
                        return new Weather.WeatherForecastData.OutgoingRequest(paramsProvider).fromPacket(this);
                    default:
                        return this;
                }
            default:
                return this;
        }
    }

    private List<byte[]> serializeSliced(byte[] serializedTLV) {
        List<byte[]> retv = new ArrayList<>();
        int headerLength = 5; // Magic + (short)(bodyLength + 1) + 0x00 + extra slice info
        int bodyHeaderLength = 2; // sID + cID
        int footerLength = 2; //CRC16
        int maxBodySize = paramsProvider.getSliceSize() - headerLength - footerLength;
        int packetCount = (int) Math.ceil(((double) serializedTLV.length + (double) bodyHeaderLength) / (double) maxBodySize);

        if (packetCount == 1)
            return serializeUnsliced(serializedTLV);

        ByteBuffer buffer = ByteBuffer.wrap(serializedTLV);
        byte slice = 0x01;
        byte flag = 0x00;
        for (int i = 0; i < packetCount; i++) {
            short packetSize = (short) Math.min(paramsProvider.getSliceSize(), buffer.remaining() + headerLength + footerLength);

            ByteBuffer packet = ByteBuffer.allocate(packetSize);

            short contentSize = (short) (packetSize - headerLength - footerLength);
            int start = packet.position();

            packet.put((byte) 0x5a);                                // Magic byte
            packet.putShort((short) (packetSize - headerLength));   // Length

            if (i == packetCount - 1)
                slice = 0x03;

            packet.put(slice);                                      // Slice
            packet.put(flag);                                       // Flag
            flag += 1;

            if (slice == 0x01) {
                packet.put(this.serviceId);                         // Service ID
                packet.put(this.commandId);                         // Command ID
                slice = 0x02;
                contentSize -= 2; // To prevent taking too much data
            }

            byte[] packetContent = new byte[contentSize];
            buffer.get(packetContent);
            packet.put(packetContent);                              // Packet data

            int length = packet.position() - start;
            if (length != packetSize - footerLength) {
                // TODO: exception?
                LOG.error("Packet lengths don't match! {} != {}", length, packetSize + headerLength);
            }

            byte[] complete = new byte[length];
            packet.position(start);
            packet.get(complete, 0, length);
            int crc16 = CheckSums.getCRC16(complete, 0x0000);

            packet.putShort((short) crc16);                         // CRC16

            retv.add(packet.array());
        }
        return retv;
    }

    private List<byte[]> serializeUnsliced(byte[] serializedTLV) {
        List<byte[]> retv = new ArrayList<>();
        int headerLength = 4; // Magic + (short)(bodyLength + 1) + 0x00
        int bodyHeaderLength = 2; // sID + cID
        int footerLength = 2; //CRC16
        int bodyLength = bodyHeaderLength + serializedTLV.length;
        ByteBuffer buffer = ByteBuffer.allocate(headerLength + bodyLength);
        buffer.put((byte) 0x5A);
        buffer.putShort((short)(bodyLength + 1));
        buffer.put((byte) 0x00);
        buffer.put(this.serviceId);
        buffer.put(this.commandId);
        buffer.put(serializedTLV);
        int crc16 = CheckSums.getCRC16(buffer.array(), 0x0000);
        ByteBuffer finalBuffer = ByteBuffer.allocate(buffer.capacity() + footerLength);
        finalBuffer.put(buffer.array());
        finalBuffer.putShort((short)crc16);
        retv.add(finalBuffer.array());
        return retv;
    }

    private byte[] encryptIfRequired(byte[] payload, boolean encrypt) throws SerializeException {
        if(encrypt) {
            try {
                HuaweiTLV encryptedTlv = HuaweiTLV.encryptRaw(this.paramsProvider, payload);
                return encryptedTlv.serialize();
            } catch (HuaweiCrypto.CryptoException e) {
                throw new HuaweiPacket.SerializeException("Error to encrypt TLV");
            }
        }
        return payload;
    }

    protected List<byte[]> serializeOTAGetMode() {
        byte[] serializedTLV = { 0x01, 0x01};
        return isSliced?serializeSliced(serializedTLV):serializeUnsliced(serializedTLV);
    }

    public List<byte[]> serializeFileChunk(byte[] fileChunk, int uploadPosition, int unitSize, byte fileId, boolean useEncryption) throws SerializeException {
        List<byte[]> retv = new ArrayList<>();
        final int subHeaderLength = 6;

        int packetCount = (int) Math.ceil(((double) fileChunk.length) / (double) unitSize);

        ByteBuffer buffer = ByteBuffer.wrap(fileChunk);

        int sliceStart = uploadPosition;

        for (int i = 0; i < packetCount; i++) {

            int contentSize = Math.min(unitSize, buffer.remaining());

            ByteBuffer payload = ByteBuffer.allocate(contentSize + subHeaderLength);
            payload.put(fileId);
            payload.put((byte)i);
            payload.putInt(sliceStart);

            byte[] packetContent = new byte[contentSize];
            buffer.get(packetContent);
            payload.put(packetContent);

            byte[] new_payload = encryptIfRequired(payload.array(), useEncryption);

            if (new_payload == null) {
                throw new HuaweiPacket.SerializeException("new payload is null");
            }

            retv.addAll(serializeSliced(new_payload)); // this function has code to determine sliced and unsliced send type should be used

            sliceStart += contentSize;

        }
        return retv;
    }

    public List<byte[]> serializeFileChunk1c(byte[] fileChunk, short transferSize, int packetCount) throws SerializeException {
        List<byte[]> retv = new ArrayList<>();

        final int subHeaderLength = 1;

        ByteBuffer buffer = ByteBuffer.wrap(fileChunk);

        for (int i = 0; i < packetCount; i++) {

            short contentSize = (short) Math.min(transferSize, buffer.remaining());

            ByteBuffer payload = ByteBuffer.allocate(contentSize + subHeaderLength);
            payload.put((byte)i);

            byte[] packetContent = new byte[contentSize];
            buffer.get(packetContent);
            payload.put(packetContent);

            byte[] new_payload = encryptIfRequired(payload.array(), isEncrypted);

            if (new_payload == null) {
                throw new HuaweiPacket.SerializeException("new payload is null");
            }

            retv.addAll(serializeSliced(new_payload)); // this function has code to determine sliced and unsliced send type should be used
        }
        return retv;
    }

    public List<byte[]> serializeOTAChunk(byte[] fileChunk, int offset, int unitSize, boolean addOffset, List<Integer> bitmap) throws SerializeException {
        List<byte[]> retv = new ArrayList<>();

        int maxUnitSize = unitSize - 9;
        int packetCount = (int) Math.ceil(((double) fileChunk.length) / (double) maxUnitSize);

        ByteBuffer buffer = ByteBuffer.wrap(fileChunk);
        int sliceStart = offset;
        int chunkIdx = 0;
        for (int i = 0; i < packetCount; i++) {

            if (chunkIdx > 0xff) {
                chunkIdx = 0;
            }

            int contentSize = Math.min(maxUnitSize, buffer.remaining());

            if ((bitmap != null) && (bitmap.size() > i)) {
                // NOTE: skip already delivered parts
                if (bitmap.get(i) != 0) {
                    byte[] packetContent = new byte[contentSize];
                    buffer.get(packetContent);
                    sliceStart += maxUnitSize;
                    chunkIdx++;
                    continue;
                }
            }
            ByteBuffer payload;
            if (addOffset) {
                payload = ByteBuffer.allocate(contentSize + 4 + 1);
                payload.putInt(sliceStart);
            } else {
                payload = ByteBuffer.allocate(contentSize + 1);
            }
            payload.put((byte)chunkIdx);
            byte[] packetContent = new byte[contentSize];
            buffer.get(packetContent);
            payload.put(packetContent);
            retv.addAll(serializeSliced(payload.array()));

            sliceStart += maxUnitSize;
            chunkIdx++;

        }
        return retv;
    }

    public List<byte[]> serialize() throws CryptoException {
        // TODO: necessary for this to work:
        //       - serviceId
        //       - commandId
        //       - tlv
        // TODO: maybe use the complete flag to know if it can be serialized?

        HuaweiTLV serializableTlv;
        if (this.isEncrypted && this.paramsProvider.areTransactionsCrypted()) {
            try {
                serializableTlv = this.tlv.encrypt(paramsProvider);
            } catch (HuaweiCrypto.CryptoException e) {
                throw new CryptoException("Encrypt exception", e);
            }
        } else {
            serializableTlv = this.tlv;
        }

        byte[] serializedTLV = serializableTlv.serialize();
        List<byte[]> retv;
        if (isSliced) {
            retv = serializeSliced(serializedTLV);
        } else {
            retv = serializeUnsliced(serializedTLV);
        }
        return retv;
    }

    public HuaweiTLV getTlv() {
        return this.tlv;
    }

    public void setTlv(HuaweiTLV tlv) {
        this.tlv = tlv;
    }

    public void setEncryption(boolean b) {
        this.isEncrypted = b;
    }

    public void setSliced(boolean b) {
        this.isSliced = b;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;

        HuaweiPacket that = (HuaweiPacket) o;

        if (serviceId != that.serviceId) return false;
        if (commandId != that.commandId) return false;
        if (complete != that.complete) return false;
        if (isEncrypted != that.isEncrypted) return false;
        return Objects.equals(tlv, that.tlv);
    }

    @NonNull
    @Override
    public String toString() {
        return "HuaweiPacket{" +
                "paramsProvider=" + paramsProvider +
                ", serviceId=" + serviceId +
                ", commandId=" + commandId +
                ", tlv=" + tlv +
                ", partialPacket=" + Arrays.toString(partialPacket) +
                ", payload=" + Arrays.toString(payload) +
                ", complete=" + complete +
                ", isEncrypted=" + isEncrypted +
                ", isSliced=" + isSliced +
                '}';
    }
}

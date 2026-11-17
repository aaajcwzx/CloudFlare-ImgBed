import assert from 'node:assert/strict';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, normalizeS3UserAgent } from '../functions/utils/storage/s3Client.js';
import { normalizeQiniuChannel, isQiniuChannel, QINIU_REGIONS, prepareQiniuUpload } from '../functions/utils/storage/qiniuConfig.js';
import * as expiry from '../functions/utils/fileExpiryHelpers.js';
import { loadFunction, memoryDatabase } from './helpers/loadFunction.js';

const input = () => ({ name: 'my-qiniu', provider: 'qiniu', region: 'cn-east-1', bucketName: ' qiniu-s3-bucket ', accessKeyId: 'test-ak', secretAccessKey: 'test-sk', enabled: true });

describe('Qiniu S3 channel', () => {
    it('uses the selected regional endpoint and S3 bucket name, preserving credentials and extra settings', () => {
        for (const region of QINIU_REGIONS) {
            const channel = normalizeQiniuChannel({ ...input(), region, cdnDomain: 'https://cdn.test', quota: { enabled: true } });
            assert.equal(channel.endpoint, `https://s3.${region}.qiniucs.com`);
            assert.equal(channel.bucketName, 'qiniu-s3-bucket');
            assert.equal(channel.pathStyle, true);
            assert.equal(channel.type, 's3');
            assert.equal(channel.secretAccessKey, 'test-sk');
            assert.equal(channel.cdnDomain, 'https://cdn.test');
            assert.equal(channel.quota.enabled, true);
        }
        for (const values of [{ region: 'auto' }, { bucketName: '' }, { secretAccessKey: '' }]) {
            assert.throws(() => normalizeQiniuChannel({ ...input(), ...values }));
        }
    });

    it('recognizes existing Qiniu S3 configurations without mistaking other providers', () => {
        assert.equal(isQiniuChannel({ endpoint: 'https://s3.cn-east-1.qiniucs.com' }), true);
        for (const endpoint of ['https://s3.cn-east-1.qiniucs.com.attacker.test', 'https://s3.amazonaws.com', 'invalid']) {
            assert.equal(isQiniuChannel({ endpoint }), false);
        }
    });

    it('keeps explicit Qiniu requests within the requested provider and channel without failover', () => {
        const channels = [{ name: 'other', endpoint: 'https://s3.test' }, input(), { ...input(), name: 'second' }];
        const context = { url: new URL('https://test/upload?uploadChannel=qiniu&channelName=second'), uploadConfig: { s3: { channels, loadBalance: { enabled: true } } } };
        assert.equal(prepareQiniuUpload(context), null);
        assert.deepEqual(context.uploadConfig.s3.channels.map(ch => ch.name), ['second']);
        assert.equal(context.url.searchParams.get('uploadChannel'), 's3');
        assert.equal(context.url.searchParams.get('autoRetry'), 'false');
        assert.equal(channels.length, 3);
        const withoutName = { url: new URL('https://test/upload?uploadChannel=qiniu'), uploadConfig: { s3: { channels } } };
        assert.equal(prepareQiniuUpload(withoutName), null);
        assert.equal(withoutName.url.searchParams.get('channelName'), 'my-qiniu');
        const continuing = { url: new URL('https://test/upload?uploadChannel=qiniu&chunked=true'), uploadConfig: { s3: { channels, loadBalance: { enabled: true } } } };
        assert.equal(prepareQiniuUpload(continuing), null);
        assert.equal(continuing.url.searchParams.has('channelName'), false);
        context.url = new URL('https://test/upload?uploadChannel=qiniu&channelName=missing');
        assert.match(prepareQiniuUpload(context), /No enabled Qiniu/);
    });

    it('persists validated provider settings and rejects invalid changes before writing', async () => {
        const db = memoryDatabase();
        const route = await loadFunction('functions/api/manage/sysConfig/upload.js', { ...expiry, normalizeS3UserAgent, getDatabase: () => db });
        const call = body => route.onRequest({ env: {}, request: new Request('https://test/api/manage/sysConfig/upload', { method: 'POST', body: JSON.stringify(body) }) });
        const response = await call({ s3: { channels: [input()] } });
        assert.equal(response.status, 200);
        const saved = (await response.json()).s3.channels[0];
        assert.equal(saved.endpoint, 'https://s3.cn-east-1.qiniucs.com');
        const before = await db.get('manage@sysConfig@upload');
        assert.equal((await call({ s3: { channels: [{ ...input(), region: 'auto' }] } })).status, 400);
        assert.equal(await db.get('manage@sysConfig@upload'), before);
    });

    it('loads environment configuration without overwriting the existing S3 environment channel', async () => {
        const db = memoryDatabase();
        await db.put('manage@sysConfig@upload', JSON.stringify({ s3: { channels: [{ name: 'Qiniu_env', savePath: 'environment variable', enabled: false, cdnDomain: 'https://custom.test', quota: { enabled: true } }] } }));
        const { getUploadConfig } = await loadFunction('functions/api/manage/sysConfig/upload.js', { ...expiry });
        const settings = await getUploadConfig(db, {
            S3_ACCESS_KEY_ID: 'other-ak', S3_SECRET_ACCESS_KEY: 'other-sk', S3_BUCKET_NAME: 'other', S3_ENDPOINT: 'https://other.test',
            QINIU_ACCESS_KEY: 'ak', QINIU_SECRET_KEY: 'sk', QINIU_BUCKET_NAME: 'bucket', QINIU_REGION: 'cn-south-1',
        });
        assert.equal(settings.s3.channels.length, 2);
        assert.equal(settings.s3.channels[0].name, 'S3_env');
        assert.equal(settings.s3.channels[0].enabled, true);
        assert.equal(settings.s3.channels[1].provider, 'qiniu');
        assert.equal(settings.s3.channels[1].endpoint, 'https://s3.cn-south-1.qiniucs.com');
        assert.equal(settings.s3.channels[1].enabled, false);
        assert.equal(settings.s3.channels[1].cdnDomain, 'https://custom.test');
        assert.equal(settings.s3.channels[1].quota.enabled, true);
        const invalid = await getUploadConfig(db, { S3_ACCESS_KEY_ID: 'other', QINIU_ACCESS_KEY: 'ak', QINIU_REGION: 'invalid' });
        assert.deepEqual(invalid.s3.channels.map(channel => channel.name), ['S3_env']);
    });

    it('signs real SDK uploads for Qiniu without optional checksum headers', async () => {
        const requests = [];
        const client = createS3Client(normalizeQiniuChannel(input()), {
            requestHandler: { async handle(request) {
                requests.push(request);
                return { response: { statusCode: 200, headers: { etag: 'test' }, body: new Uint8Array() } };
            } },
        });
        try {
            await client.send(new PutObjectCommand({ Bucket: 'qiniu-s3-bucket', Key: 'photos/a.png', Body: new Uint8Array([1, 2]), ContentType: 'image/png' }));
            assert.equal(requests.length, 1);
            const request = requests[0];
            assert.equal(request.hostname, 's3.cn-east-1.qiniucs.com');
            assert.equal(request.path, '/qiniu-s3-bucket/photos/a.png');
            assert.match(request.headers.authorization, /Credential=test-ak\/\d{8}\/cn-east-1\/s3\/aws4_request/);
            assert.equal(Object.keys(request.headers).some(key => key.startsWith('x-amz-checksum-')), false);
        } finally { client.destroy(); }
    });
});

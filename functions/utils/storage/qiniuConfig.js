// Qiniu Kodo uses the existing S3 adapter, keeping reads, deletes and multipart uploads compatible.
export const QINIU_REGIONS = [
    'cn-east-1', 'cn-east-2', 'cn-north-1', 'cn-south-1',
    'us-north-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3',
];

export function isQiniuChannel(channel = {}) {
    if (channel.provider === 'qiniu') return true;
    try {
        return /^s3\.[a-z0-9-]+\.qiniucs\.com$/.test(new URL(channel.endpoint).hostname);
    } catch { return false; }
}

export function normalizeQiniuChannel(channel) {
    const region = channel.region || 'cn-east-1';
    if (!QINIU_REGIONS.includes(region)) throw new Error('Invalid Qiniu storage region');
    if (!channel.bucketName?.trim()) throw new Error('Qiniu S3 bucket name is required');
    if (!channel.accessKeyId?.trim() || !channel.secretAccessKey?.trim()) {
        throw new Error('Qiniu Access Key and Secret Key are required');
    }
    return {
        ...channel,
        type: 's3',
        provider: 'qiniu',
        region,
        endpoint: `https://s3.${region}.qiniucs.com`,
        bucketName: channel.bucketName.trim(),
        pathStyle: channel.pathStyle ?? true,
    };
}

// Explicit Qiniu requests must never silently select a different provider or channel.
export function prepareQiniuUpload(context) {
    if (context.url.searchParams.get('uploadChannel') !== 'qiniu') return null;
    const s3 = context.uploadConfig.s3 || { channels: [] };
    let channels = s3.channels.filter(channel => channel.enabled !== false && isQiniuChannel(channel));
    const name = context.url.searchParams.get('channelName');
    if (name) channels = channels.filter(channel => channel.name === name);
    if (!channels.length) return 'Error: No enabled Qiniu channel matches this request';
    context.uploadConfig = { ...context.uploadConfig, s3: { ...s3, channels } };
    context.url.searchParams.set('uploadChannel', 's3');
    // Continued chunks use the channel pinned in their initialization session.
    if (!context.url.searchParams.has('chunked') && !context.url.searchParams.has('cleanup')) {
        const selected = name || (s3.loadBalance?.enabled
            ? channels[Math.floor(Math.random() * channels.length)].name : channels[0].name);
        context.url.searchParams.set('channelName', selected);
    }
    context.url.searchParams.set('autoRetry', 'false');
    return null;
}

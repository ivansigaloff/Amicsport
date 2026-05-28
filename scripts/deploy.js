require('dotenv').config();
const FtpDeploy = require('ftp-deploy');
const path = require('path');

const { FTP_HOST, FTP_USER, FTP_PASSWORD } = process.env;
if (!FTP_HOST || !FTP_USER || !FTP_PASSWORD) {
    console.error('❌ Missing FTP_HOST / FTP_USER / FTP_PASSWORD in .env');
    process.exit(1);
}

const ftpDeploy = new FtpDeploy();

const config = {
    user: FTP_USER,
    password: FTP_PASSWORD,
    host: FTP_HOST,
    port: 21,
    localRoot: path.join(__dirname, '../dist'),
    remoteRoot: '/multigraf.info/Kickerzbcn/',
    include: ['*', '**/*'],
    deleteRemote: true,              // delete existing files in remoteRoot before uploading
    forcePasv: true,                 // Passive mode is usually required for FTP uploads
    sftp: false                      // set to true if using sftp
};

console.log('🚀 Starting deployment to FTP...');
console.log(`📡 Host: ${config.host}`);
console.log(`📂 Source: ${config.localRoot}`);
console.log(`🎯 Destination: ${config.remoteRoot}`);

ftpDeploy.on('uploading', (data) => {
    console.log(`📤 Uploading (${data.transferredFileCount}/${data.totalFilesCount}): ${data.filename}`);
});

ftpDeploy.on('uploaded', (data) => {
    console.log(`✅ Uploaded ${data.transferredFileCount}/${data.totalFilesCount}: ${data.filename}`);
});

ftpDeploy.on('log', (data) => {
    console.log(data);
});

ftpDeploy.on('upload-error', (data) => {
    console.error(`❌ Error uploading ${data.filename}:`, data.err);
});

ftpDeploy
    .deploy(config)
    .then(() => {
        console.log('\n✨ Deployment finished successfully!');
        console.log('🔗 URL: http://multigraf.info/Kickerzbcn/');
    })
    .catch((err) => {
        console.error('\n💥 Deployment failed!');
        console.error(err);
    });

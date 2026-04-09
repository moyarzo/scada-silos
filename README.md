# SCADA-LB

SCADA-LB is a project developed to visualize bulk product level data in industrial storage silos. Radar sensors installed in each silo were used to measure the level, communicating via the Modbus protocol with an HMI screen. The HMI screen is capable of publishing messages to an MQTT broker.


<img width="1904" height="920" alt="image" src="https://github.com/user-attachments/assets/c1c06395-f542-4b78-9d03-b2ca7f4221ad" />



## Building and Running SCADA-LB Locally
Building and running SCADA-LB in your local dev environment is very easy. Be sure you have Git and Node.js installed, then follow the directions below.

1. Clone the source code:
```sh
git clone https://github.com/moyarzo/scada-silos.git
```

2. Install development dependencies:
```sh
npm install
```
```sh
npm install express
```
```sh
npm install socket.io
```
```sh
npm install mqtt
```
```sh
npm install pm2 -g
```

3. Run a local development server:
```sh
pm2 start server.js --name scada-silos
```
```sh
pm2 save
```


> [!IMPORTANT]
>SCADA-LB is now running, and can be accessed by pointing a web browser at http://localhost:3000/

SCADA-LB is built using npm and Mosquitto MQTT broker.

## Testing

# SCADA-LB

SCADA-LB is a project developed to visualize bulk product level data in industrial storage silos. Radar sensors installed in each silo were used to measure the level, communicating via the Modbus protocol with an HMI screen. The HMI screen is capable of publishing messages to an MQTT broker. The developed dashboard displays operational data from the silos, such as mass calculations, consumption records, alarms, among others, and also allows changing the product in the silos.


<img width="1912" height="881" alt="image" src="https://github.com/user-attachments/assets/17e989af-3a72-4fb1-befe-880ae4728f3d" />





## Building and running locally
Building and running SCADA-LB in your local dev environment is very easy. Be sure you have [npm](http://npmjs.com/), [Git](https://git-scm.com/downloads), [Node.js](https://nodejs.org/), and [Eclipse Mosquitto](https://mosquitto.org/) installed, then follow the directions below.

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


## Testing

The dashboard includes a switch for demo mode and another for live mode. In demo mode, you can test the functions with random data. In live mode, it reads data from the MQTT broker.


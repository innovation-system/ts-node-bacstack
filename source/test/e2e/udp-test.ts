import {createSocket} from 'dgram';

// Configurazioni da testare
const configs = [
  {serverInterface: '0.0.0.0', clientDestination: '127.0.0.1'},
  {serverInterface: '127.0.0.1', clientDestination: '127.0.0.1'},
  {serverInterface: '0.0.0.0', clientDestination: '192.168.1.255', broadcast: true},
  {serverInterface: '0.0.0.0', clientDestination: '255.255.255.255', broadcast: true}
];

// Porta da testare (usa la stessa del simulatore)
const PORT = 47808;

async function testConnection(config: any, index: number): Promise<void> {
  return new Promise((resolve) => {
    console.log(`\n--- Test configurazione ${index + 1} ---`);
    console.log(`Server su: ${config.serverInterface}:${PORT}`);
    console.log(`Client invia a: ${config.clientDestination}:${PORT}`);

    // Crea server UDP
    const server = createSocket('udp4');

    server.on('error', (err) => {
      console.error(`Server error: ${err.message}`);
      server.close();
      resolve();
    });

    server.on('message', (msg, rinfo) => {
      console.log(`✅ SUCCESSO! Ricevuto messaggio da ${rinfo.address}:${rinfo.port}`);
      console.log(`Messaggio: ${msg.toString()}`);
      server.close();
      setTimeout(resolve, 500);
    });

    server.on('listening', () => {
      console.log(`Server in ascolto su ${config.serverInterface}:${PORT}`);

      // Crea client UDP
      const client = createSocket('udp4');

      if (config.broadcast) {
        client.setBroadcast(true);
      }

      const message = Buffer.from(`Test messaggio ${index + 1}`);

      client.send(Uint8Array.from(message), PORT, config.clientDestination, (err) => {
        if (err) {
          console.error(`❌ Errore invio: ${err.message}`);
        } else {
          console.log(`Messaggio inviato a ${config.clientDestination}:${PORT}`);
        }

        // Chiudi client dopo l'invio
        client.close();

        // Se non riceviamo risposta entro 3 secondi, fallisce
        setTimeout(() => {
          console.log(`❌ FALLITO: Nessuna risposta ricevuta`);
          server.close();
          resolve();
        }, 3000);
      });
    });

    // Avvia server
    server.bind(PORT, config.serverInterface);
  });
}

async function runTests() {
  for (let i = 0; i < configs.length; i++) {
    await testConnection(configs[i], i);
  }
  console.log('\nTest completati!');
}

runTests();

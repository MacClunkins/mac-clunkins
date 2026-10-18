import { InboxBody } from '../supplier-driver-shared/InboxBody';
import { BuyerLayout } from './components/BuyerLayout';

export default function BuyerNotifications() {
  return (
    <BuyerLayout>
      <InboxBody role="buyer" />
    </BuyerLayout>
  );
}
